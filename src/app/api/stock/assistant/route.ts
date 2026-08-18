import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { apiErrorResponse, requireAuthenticatedActor } from '@/lib/auth/api-auth';
import { OdooApiError, OdooConfigurationError } from '@/lib/odoo/client';
import {
  buildShowAllStockResponse,
  resolveDeterministicStockAssistant,
  resolveStockAssistant,
  StockAssistantError,
} from '@/lib/stock/assistant';
import { extractStockSearchTerms } from '@/lib/stock/query';
import { getAvailableStock } from '@/lib/stock/service';
import {
  MAX_STOCK_HISTORY_MESSAGES,
  MAX_STOCK_HISTORY_MESSAGE_LENGTH,
  MAX_STOCK_QUERY_LENGTH,
} from '@/lib/stock/limits';
import type { StockAssistantConversationMessage } from '@/lib/stock/types';
import {
  extractCustomerSearchCity,
  extractCustomerSearchName,
  isCustomerLookupQuery,
} from '@/lib/customers/query';
import { buildCustomerAssistantResponse, findCustomersByCity, findCustomersByName } from '@/lib/customers/service';
import { isProformaAssistantRequest, resolveProformaAssistant } from '@/lib/odoo/proforma-assistant';

export const runtime = 'nodejs';

const DEFAULT_QUERY_MODEL = 'gpt-4o-mini';

export async function GET(request: NextRequest) {
  try {
    await requireAuthenticatedActor(request);
  } catch (error) {
    return apiErrorResponse(error);
  }
  return NextResponse.json({
    configured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_QUERY_MODEL?.trim() || DEFAULT_QUERY_MODEL,
  });
}

export async function POST(request: NextRequest) {
  let actor: Awaited<ReturnType<typeof requireAuthenticatedActor>>;
  try {
    actor = await requireAuthenticatedActor(request, { write: true });
  } catch (error) {
    return apiErrorResponse(error);
  }

  try {
    const body = await request.json() as { query?: unknown; history?: unknown; proformaDraft?: unknown };
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      return NextResponse.json({ error: 'Ask the inventory assistant a question.' }, { status: 400 });
    }
    if (query.length > MAX_STOCK_QUERY_LENGTH) {
      return NextResponse.json(
        { error: `Keep the inventory request below ${MAX_STOCK_QUERY_LENGTH} characters.` },
        { status: 400 },
      );
    }
    const history = readConversationHistory(body.history);
    if (history === null) {
      return NextResponse.json({ error: 'The conversation context is invalid.' }, { status: 400 });
    }

    if (isProformaAssistantRequest(query, body.proformaDraft)) {
      const result = await resolveProformaAssistant({
        query,
        companyId: actor.currentCompanyId,
        draft: body.proformaDraft,
      });
      return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    if (isCustomerLookupQuery(query)) {
      const searchCity = extractCustomerSearchCity(query);
      const searchMode = searchCity ? 'city' : 'name';
      const searchTerm = searchCity ?? extractCustomerSearchName(query);
      const customers = searchTerm
        ? searchCity
          ? await findCustomersByCity(searchCity, actor.currentCompanyId)
          : await findCustomersByName(searchTerm, actor.currentCompanyId)
        : [];
      return NextResponse.json(buildCustomerAssistantResponse(
        query,
        searchTerm,
        customers,
        searchMode,
      ), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    const inventory = await getAvailableStock('');
    if (extractStockSearchTerms(query).length === 0) {
      return NextResponse.json(buildShowAllStockResponse(query, inventory.products), {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(resolveDeterministicStockAssistant(
        query,
        inventory.products,
        'AI interpretation is not configured, so I used local catalog matching.',
      ), { headers: { 'Cache-Control': 'no-store' } });
    }
    let result;
    try {
      result = await resolveStockAssistant(query, inventory.products, {
        apiKey,
        model: process.env.OPENAI_QUERY_MODEL,
        history,
      });
    } catch (error) {
      if (!(error instanceof StockAssistantError)) throw error;
      result = resolveDeterministicStockAssistant(query, inventory.products, error.message);
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'The inventory request body is invalid JSON.' }, { status: 400 });
    }
    console.error('Inventory assistant request failed:', error);
    if (error instanceof OdooConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (error instanceof OdooApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === 429 ? 429 : 502 },
      );
    }
    return NextResponse.json({ error: 'The inventory assistant could not complete the request.' }, { status: 500 });
  }
}

function readConversationHistory(value: unknown): StockAssistantConversationMessage[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_STOCK_HISTORY_MESSAGES) return null;

  const messages: StockAssistantConversationMessage[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const candidate = item as Record<string, unknown>;
    if ((candidate.role !== 'user' && candidate.role !== 'assistant')
      || typeof candidate.content !== 'string') return null;
    const content = candidate.content.trim();
    if (!content || content.length > MAX_STOCK_HISTORY_MESSAGE_LENGTH) return null;
    messages.push({ role: candidate.role, content });
  }
  return messages;
}
