import 'server-only';

import type {
  AvailableStockItem,
  StockAssistantConversationMessage,
  StockAssistantRequestResult,
  StockAssistantResponse,
  StockResolutionStatus,
} from './types';
import {
  MAX_STOCK_HISTORY_MESSAGES,
  MAX_STOCK_HISTORY_MESSAGE_LENGTH,
  MAX_STOCK_REQUEST_ITEMS,
} from './limits';
import { matchStockRequestProducts, splitStockRequests } from './query';

const DEFAULT_QUERY_MODEL = 'gpt-4o-mini';

interface OpenAIResponseBody {
  status?: string;
  incomplete_details?: { reason?: string };
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  error?: { message?: string; code?: string };
}

export class StockAssistantError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'StockAssistantError';
    this.status = status;
  }
}

export async function resolveStockAssistant(
  query: string,
  inventory: AvailableStockItem[],
  options: {
    apiKey: string;
    model?: string;
    history?: StockAssistantConversationMessage[];
    fetchImpl?: typeof fetch;
  },
): Promise<StockAssistantResponse> {
  const model = options.model?.trim() || DEFAULT_QUERY_MODEL;
  if (inventory.length === 0) {
    return resolveDeterministicStockAssistant(query, inventory);
  }

  const productIds = inventory.map((product) => product.id);
  const catalog = inventory.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
  }));
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 3_000,
        instructions: inventoryPlannerInstructions(),
        input: buildPlannerInput(query, catalog, options.history ?? []),
        text: {
          format: {
            type: 'json_schema',
            name: 'inventory_lookup_plan',
            strict: true,
            schema: stockPlanSchema(productIds),
          },
        },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error
      && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new StockAssistantError(
      timedOut
        ? 'AI interpretation timed out, so I used local catalog matching.'
        : 'AI interpretation could not connect, so I used local catalog matching.',
      timedOut ? 504 : 502,
    );
  }
  const body = await response.json().catch(() => ({})) as OpenAIResponseBody;
  if (!response.ok) {
    const message = openAIErrorMessage(response.status);
    console.error('OpenAI inventory planning failed:', response.status, body.error?.code, body.error?.message);
    throw new StockAssistantError(message, response.status === 429 ? 429 : 502);
  }

  if (body.status === 'incomplete') {
    throw new StockAssistantError(
      `AI interpretation was incomplete${body.incomplete_details?.reason ? ` (${body.incomplete_details.reason})` : ''}, so I used local catalog matching.`,
    );
  }

  const outputText = extractOutputText(body);
  if (!outputText) {
    throw new StockAssistantError('The AI inventory assistant returned no usable response.');
  }

  let plan: unknown;
  try {
    plan = JSON.parse(outputText);
  } catch {
    throw new StockAssistantError('The AI inventory assistant returned an invalid response.');
  }
  const grounded = groundStockPlan(plan, inventory);
  if (grounded.length === 0) {
    return resolveDeterministicStockAssistant(
      query,
      inventory,
      'AI interpretation returned no request groups, so I used local catalog matching.',
    );
  }
  return buildStockAssistantResponse(query, model, 'ai', grounded, new Date().toISOString());
}

export function resolveDeterministicStockAssistant(
  query: string,
  inventory: AvailableStockItem[],
  warning?: string,
): StockAssistantResponse {
  const requests = splitStockRequests(query).map((requested) => {
    const products = matchStockRequestProducts(requested, inventory);
    const status: StockResolutionStatus = products.length > 0 ? 'matched' : 'not_found';
    return {
      requested,
      interpretation: requested,
      status,
      reason: products.length > 0
        ? 'Matched using normalized catalog terms.'
        : 'No available catalog product matched this part of the request.',
      products,
    };
  });
  return buildStockAssistantResponse(
    query,
    'local catalog matching',
    'deterministic',
    requests,
    new Date().toISOString(),
    warning,
  );
}

export function buildShowAllStockResponse(
  query: string,
  inventory: AvailableStockItem[],
): StockAssistantResponse {
  const request: StockAssistantRequestResult = {
    requested: query,
    interpretation: 'All available stock',
    status: inventory.length > 0 ? 'matched' : 'not_found',
    reason: inventory.length > 0
      ? 'Showing every product with a positive available quantity.'
      : 'There is currently no unreserved stock available.',
    products: inventory,
  };
  return buildStockAssistantResponse(
    query,
    'deterministic',
    'deterministic',
    [request],
    new Date().toISOString(),
  );
}

export function groundStockPlan(
  value: unknown,
  inventory: AvailableStockItem[],
): StockAssistantRequestResult[] {
  if (!isRecord(value) || !Array.isArray(value.requests)) {
    throw new StockAssistantError('The AI inventory assistant returned an invalid plan.');
  }
  const inventoryById = new Map(inventory.map((product) => [product.id, product]));

  return value.requests.slice(0, MAX_STOCK_REQUEST_ITEMS).map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new StockAssistantError('The AI inventory assistant returned an invalid request item.');
    }
    const requested = readString(candidate.requested) || `Requested item ${index + 1}`;
    const interpretation = readString(candidate.interpretation) || requested;
    const reason = readString(candidate.reason);
    const requestedStatus = readStatus(candidate.status);
    const ids = Array.isArray(candidate.matchedProductIds)
      ? candidate.matchedProductIds.filter((id): id is number => Number.isInteger(id))
      : [];
    const products = [...new Set(ids)]
      .map((id) => inventoryById.get(id))
      .filter((product): product is AvailableStockItem => Boolean(product));
    const status = products.length === 0
      ? 'not_found'
      : requestedStatus === 'not_found' ? 'possible_match' : requestedStatus;

    return {
      requested,
      interpretation,
      status,
      reason: reason || defaultReason(status),
      products,
    };
  });
}

function buildStockAssistantResponse(
  query: string,
  model: string,
  source: StockAssistantResponse['source'],
  requests: StockAssistantRequestResult[],
  fetchedAt: string,
  warning?: string,
): StockAssistantResponse {
  const products = [...new Map(
    requests.flatMap((request) => request.products).map((product) => [product.id, product]),
  ).values()];
  const possibleCount = requests.filter((request) => request.status === 'possible_match').length;
  const missingCount = requests.filter((request) => request.status === 'not_found').length;
  let assistantMessage: string;
  if (products.length === 0) {
    assistantMessage = requests.length === 0
      ? 'I can help with live inventory lookups. Ask for a product, brand, rating, color, or SKU.'
      : 'I could not confidently match that request to currently available inventory.';
  } else {
    assistantMessage = `I found ${products.length} available ${products.length === 1 ? 'product' : 'products'}`;
    if (requests.length > 1) assistantMessage += ` across ${requests.length} requested ${requests.length === 1 ? 'item' : 'items'}`;
    assistantMessage += '.';
    if (possibleCount > 0) assistantMessage += ` ${possibleCount} ${possibleCount === 1 ? 'result is' : 'results are'} marked as a possible match.`;
    if (missingCount > 0) assistantMessage += ` I could not match ${missingCount} ${missingCount === 1 ? 'item' : 'items'}.`;
  }

  return {
    kind: 'stock',
    query,
    assistantMessage,
    model,
    source,
    fetchedAt,
    requests,
    products,
    ...(warning ? { warning } : {}),
  };
}

function stockPlanSchema(productIds: number[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['intent', 'requests'],
    properties: {
      intent: { type: 'string', enum: ['lookup', 'show_all', 'unsupported'] },
      requests: {
        type: 'array',
        maxItems: MAX_STOCK_REQUEST_ITEMS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['requested', 'interpretation', 'status', 'reason', 'matchedProductIds'],
          properties: {
            requested: { type: 'string' },
            interpretation: { type: 'string' },
            status: { type: 'string', enum: ['matched', 'possible_match', 'not_found'] },
            reason: { type: 'string' },
            matchedProductIds: {
              type: 'array',
              items: { type: 'integer', enum: productIds },
            },
          },
        },
      },
    },
  };
}

function inventoryPlannerInstructions(): string {
  return `You are a grounded solar inventory query planner. Convert the user's natural-language or speech-transcribed request into product selections from the supplied catalog.

Rules:
- The supplied catalog is the only source of truth. Never invent a product, ID, SKU, brand, specification, or quantity.
- Produce exactly one request entry per conceptual item. A user may provide bullets, commas, new lines, or conjunctions.
- Preserve the user's wording in "requested". If you infer a correction, put it only in "interpretation" and "reason".
- Use the conversation context only to resolve follow-up references such as "also", "that one", or "the 6 kW version". The current request is always the task to answer.
- When one request asks for variants such as "black and red", include every matching catalog product in that same request entry.
- Understand speech variants and equivalent notation: kilowatt/kW, watt/Wp, 5 kW/5000 W, square millimetres/mm2, X2/x 2, single phase/1ph, and spoken numbers.
- Resolve model naming conventions from the catalog, for example 5000TL-X2 can represent a spoken "five thousand x two".
- Prefer exact brand, capacity, color, phase, technology, DCR/NDCR, and model matches.
- Use status "matched" only when the requested constraints agree with the catalog product.
- Use "possible_match" for a close likely transcription error and explain the discrepancy briefly. Return at most three candidates. Never emit both a not_found entry and a corrected possible_match entry for the same requested item.
- Use "not_found" with an empty matchedProductIds array when no catalog product is plausible.
- Never state or estimate stock quantities. The application joins live quantities after your selection.
- If the user asks for all available stock, set intent to "show_all" and select every catalog ID.
- Keep requested, interpretation, and reason concise.`;
}

function buildPlannerInput(
  query: string,
  catalog: Array<{ id: number; sku: string | null; name: string }>,
  history: StockAssistantConversationMessage[],
): string {
  const safeHistory = history.slice(-MAX_STOCK_HISTORY_MESSAGES).map((message) => ({
    role: message.role,
    content: message.content.slice(0, MAX_STOCK_HISTORY_MESSAGE_LENGTH),
  }));
  const context = safeHistory.length > 0
    ? JSON.stringify(safeHistory)
    : 'No earlier conversation.';
  return `RECENT CONVERSATION CONTEXT (oldest first):\n${context}\n\nCURRENT USER INVENTORY REQUEST:\n${query}\n\nAUTHORITATIVE AVAILABLE PRODUCT CATALOG:\n${JSON.stringify(catalog)}`;
}

function openAIErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return 'AI authentication failed, so I used local catalog matching. Check the OpenAI API key.';
  }
  if (status === 429) {
    return 'AI usage is temporarily unavailable, so I used local catalog matching. Check OpenAI billing or rate limits.';
  }
  if (status >= 500) {
    return 'The AI service is temporarily unavailable, so I used local catalog matching.';
  }
  return 'AI interpretation rejected the request, so I used local catalog matching.';
}

function extractOutputText(body: OpenAIResponseBody): string {
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) return content.text;
      if (content.type === 'refusal' && content.refusal) {
        throw new StockAssistantError('The AI inventory assistant could not process that request.', 400);
      }
    }
  }
  return '';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStatus(value: unknown): StockResolutionStatus {
  return value === 'matched' || value === 'possible_match' || value === 'not_found'
    ? value
    : 'not_found';
}

function defaultReason(status: StockResolutionStatus): string {
  if (status === 'matched') return 'Matched to the available catalog.';
  if (status === 'possible_match') return 'This is the closest available catalog match.';
  return 'No available catalog product matched this request.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
