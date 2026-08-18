import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  buildShowAllStockResponse,
  groundStockPlan,
  resolveDeterministicStockAssistant,
  resolveStockAssistant,
} from './assistant';
import type { AvailableStockItem } from './types';

const inventory: AvailableStockItem[] = [
  product(1, 'Acc-30000014', 'POLYCAB Solar DC Cable 4mm² Black', 440),
  product(2, 'Acc-30000015', 'POLYCAB Solar DC Cable 4mm² Red', 500),
  product(3, 'Inv-20000230', 'Polycab 5 KW Single Phase Solar Inverter 1MPPT', 24),
  product(4, 'BOS-40000125', 'Earthing Kit (AF)', 18),
  product(5, 'Inv-20000125', 'Growatt MIN 5000TL-X2 (Pro) Solar Inverter', 233),
  product(6, 'SM-10000287', 'RENEW 550Wp PERC BF DCR Solar Module', 59),
];

describe('grounded inventory assistant', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('grounds multiple interpreted requests to live inventory objects', () => {
    const result = groundStockPlan({
      intent: 'lookup',
      requests: [
        {
          requested: 'Polycab cable, black and red',
          interpretation: 'Polycab 4mm² DC cable in both colors',
          status: 'matched',
          reason: 'Both color variants match.',
          matchedProductIds: [1, 2],
        },
        {
          requested: 'Polycab 5 kW',
          interpretation: 'Polycab 5 kW inverter',
          status: 'matched',
          reason: 'Exact capacity match.',
          matchedProductIds: [3],
        },
      ],
    }, inventory);

    expect(result).toHaveLength(2);
    expect(result[0].products.map((item) => item.id)).toEqual([1, 2]);
    expect(result[1].products.map((item) => item.id)).toEqual([3]);
  });

  it('drops invented IDs and never fabricates an inventory object', () => {
    const [result] = groundStockPlan({
      intent: 'lookup',
      requests: [{
        requested: 'Invented product',
        interpretation: 'Invented product',
        status: 'matched',
        reason: 'Claimed match.',
        matchedProductIds: [999999],
      }],
    }, inventory);

    expect(result.status).toBe('not_found');
    expect(result.products).toEqual([]);
  });

  it('sends names and IDs to the model but joins quantities only on the server', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body)) as {
        text: { format: { schema: { properties: { requests: { items: { properties: { matchedProductIds: { items: { enum: number[] } } } } } } } } };
      };
      expect(requestBody.text.format.schema.properties.requests.items.properties.matchedProductIds.items.enum)
        .toEqual([1, 2, 3, 4, 5, 6]);
      expect(String(init?.body)).not.toContain('"available":');
      expect(String(init?.body)).not.toContain('uniqueItems');
      expect(String(init?.body)).toContain('What about the 5 kW one?');

      return Response.json({
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            text: JSON.stringify({
              intent: 'lookup',
              requests: [{
                requested: 'Polycab 5 kilowatt',
                interpretation: 'Polycab 5 kW inverter',
                status: 'matched',
                reason: 'Exact catalog match.',
                matchedProductIds: [3],
              }],
            }),
          }],
        }],
      });
    }) as unknown as typeof fetch;

    const result = await resolveStockAssistant('Polycab 5 kilowatt', inventory, {
      apiKey: 'test-key',
      history: [{ role: 'user', content: 'What about the 5 kW one?' }],
      fetchImpl,
    });

    expect(result.source).toBe('ai');
    expect(result.products).toEqual([inventory[2]]);
    expect(result.assistantMessage).toBe('I found 1 available product.');
  });

  it('returns all stock without an LLM call for a show-all request', () => {
    const result = buildShowAllStockResponse('Show all available stock', inventory);
    expect(result.source).toBe('deterministic');
    expect(result.products).toEqual(inventory);
    expect(result.requests[0].products).toEqual(inventory);
  });

  it('matches multi-line requests and coordinated color variants without AI', () => {
    const result = resolveDeterministicStockAssistant([
      'Polycab solar DC cable 4 mm black and red',
      'earthing kit',
      'Growatt 5000 X2 Pro',
    ].join('\n'), inventory, 'AI temporarily unavailable.');

    expect(result.source).toBe('deterministic');
    expect(result.warning).toBe('AI temporarily unavailable.');
    expect(result.requests).toHaveLength(3);
    expect(result.requests[0].products.map((item) => item.id)).toEqual([1, 2]);
    expect(result.requests[1].products.map((item) => item.id)).toEqual([4]);
    expect(result.requests[2].products.map((item) => item.id)).toEqual([5]);
  });

  it('turns an OpenAI network failure into a recoverable assistant error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    await expect(resolveStockAssistant('Polycab 5 kW', inventory, {
      apiKey: 'test-key',
      fetchImpl,
    })).rejects.toMatchObject({
      name: 'StockAssistantError',
      status: 502,
      message: expect.stringContaining('local catalog matching'),
    });
  });

  it('falls back locally when AI returns no request groups', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      status: 'completed',
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: JSON.stringify({ intent: 'lookup', requests: [] }),
        }],
      }],
    })) as unknown as typeof fetch;

    const result = await resolveStockAssistant('earthing kit', inventory, {
      apiKey: 'test-key',
      fetchImpl,
    });

    expect(result.source).toBe('deterministic');
    expect(result.products.map((item) => item.id)).toEqual([4]);
    expect(result.warning).toContain('no request groups');
  });
});

function product(id: number, sku: string, name: string, available: number): AvailableStockItem {
  return {
    id,
    sku,
    name,
    uom: 'Units',
    available,
    onHand: available,
    reserved: 0,
    incoming: 0,
    outgoing: 0,
    forecast: available,
  };
}
