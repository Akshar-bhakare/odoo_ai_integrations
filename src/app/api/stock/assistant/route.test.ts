import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAvailableStock: vi.fn(),
  findCustomersByName: vi.fn(),
  findCustomersByCity: vi.fn(),
  isProformaAssistantRequest: vi.fn(() => false),
  resolveProformaAssistant: vi.fn(),
  requireAuthenticatedActor: vi.fn(async () => ({ userId: 2, currentCompanyId: 7 })),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/api-auth', () => ({
  requireAuthenticatedActor: mocks.requireAuthenticatedActor,
  apiErrorResponse: (error: unknown) => Response.json({
    error: error instanceof Error ? error.message : 'Authentication failed',
  }, { status: 401 }),
}));
vi.mock('@/lib/stock/service', () => ({ getAvailableStock: mocks.getAvailableStock }));
vi.mock('@/lib/customers/service', () => ({
  findCustomersByName: mocks.findCustomersByName,
  findCustomersByCity: mocks.findCustomersByCity,
  buildCustomerAssistantResponse: (query: string, searchName: string, customers: unknown[], searchMode = 'name') => ({
    kind: 'customer',
    query,
    searchName,
    searchMode,
    assistantMessage: `Found ${customers.length}`,
    source: 'odoo',
    fetchedAt: '2026-09-05T00:00:00.000Z',
    customers,
  }),
}));
vi.mock('@/lib/odoo/proforma-assistant', () => ({
  isProformaAssistantRequest: mocks.isProformaAssistantRequest,
  resolveProformaAssistant: mocks.resolveProformaAssistant,
}));

import { NextRequest } from 'next/server';
import { POST } from './route';
import { MAX_STOCK_QUERY_LENGTH } from '@/lib/stock/limits';
import type { AvailableStockItem } from '@/lib/stock/types';

const originalApiKey = process.env.OPENAI_API_KEY;
const inventory = [
  product(1, 'Acc-30000014', 'POLYCAB Solar DC Cable 4mm² Black'),
  product(2, 'Acc-30000015', 'POLYCAB Solar DC Cable 4mm² Red'),
  product(3, 'Inv-20000230', 'Polycab 5 KW Single Phase Solar Inverter 1MPPT'),
];

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env.OPENAI_API_KEY = 'test-key';
  mocks.requireAuthenticatedActor.mockResolvedValue({ userId: 2, currentCompanyId: 7 });
  mocks.findCustomersByName.mockResolvedValue([]);
  mocks.findCustomersByCity.mockResolvedValue([]);
  mocks.isProformaAssistantRequest.mockReturnValue(false);
  mocks.getAvailableStock.mockResolvedValue({
    spokenQuery: '',
    searchTerms: [],
    fetchedAt: '2026-09-05T00:00:00.000Z',
    products: inventory,
  });
});

afterAll(() => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  vi.unstubAllGlobals();
});

describe('POST /api/stock/assistant', () => {
  it('accepts a request longer than the retired 160-character endpoint limit', async () => {
    mockOpenAIPlan([3]);
    const query = `${'Please check Polycab inventory. '.repeat(8)}Polycab 5 kW`;

    const response = await POST(stockRequest({ query, history: [] }));
    const body = await response.json();

    expect(query.length).toBeGreaterThan(160);
    expect(response.status).toBe(200);
    expect(body.source).toBe('ai');
    expect(body.products).toHaveLength(1);
  });

  it('uses one server-side deterministic fallback when OpenAI is not configured', async () => {
    delete process.env.OPENAI_API_KEY;

    const response = await POST(stockRequest({
      query: 'Polycab solar DC cable 4 mm black and red\nPolycab 5 kW',
      history: [],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe('deterministic');
    expect(body.warning).toContain('not configured');
    expect(body.requests).toHaveLength(2);
    expect(body.products.map((item: AvailableStockItem) => item.id)).toEqual([1, 2, 3]);
  });

  it('returns grounded local results with a visible warning when OpenAI returns 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: { code: 'rate_limit_exceeded', message: 'Rate limit' },
    }, { status: 429 })));

    const response = await POST(stockRequest({ query: 'Polycab 5 kW', history: [] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe('deterministic');
    expect(body.warning).toContain('billing or rate limits');
    expect(body.products.map((item: AvailableStockItem) => item.id)).toEqual([3]);
  });

  it('rejects only requests above the shared application limit', async () => {
    const response = await POST(stockRequest({ query: 'x'.repeat(MAX_STOCK_QUERY_LENGTH + 1) }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: `Keep the inventory request below ${MAX_STOCK_QUERY_LENGTH} characters.`,
    });
    expect(mocks.getAvailableStock).not.toHaveBeenCalled();
  });

  it('returns a clear client error for malformed JSON', async () => {
    const response = await POST(stockRequest('{'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'The inventory request body is invalid JSON.' });
  });

  it('answers show-all requests without calling OpenAI', async () => {
    const openAIFetch = vi.fn();
    vi.stubGlobal('fetch', openAIFetch);

    const response = await POST(stockRequest({ query: 'Show all available stock' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.products).toHaveLength(3);
    expect(openAIFetch).not.toHaveBeenCalled();
  });

  it('routes customer-detail requests to company-scoped Odoo customer lookup', async () => {
    mocks.findCustomersByName.mockResolvedValue([{
      id: 44,
      name: 'Bright Power Pvt Ltd',
      gstNo: '27ABCDE1234F1Z5',
      phone: '0201234567',
      address: 'Pune\nMaharashtra, 411001\nIndia',
    }]);
    const openAIFetch = vi.fn();
    vi.stubGlobal('fetch', openAIFetch);

    const response = await POST(stockRequest({
      query: 'Find customer Bright Power Pvt Ltd and show GST, phone and address',
      history: [],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.kind).toBe('customer');
    expect(body.customers).toHaveLength(1);
    expect(mocks.findCustomersByName).toHaveBeenCalledWith('Bright Power Pvt Ltd', 7);
    expect(mocks.getAvailableStock).not.toHaveBeenCalled();
    expect(openAIFetch).not.toHaveBeenCalled();
  });

  it('routes city customer requests to the Odoo city filter', async () => {
    mocks.findCustomersByCity.mockResolvedValue([{
      id: 51,
      name: 'Nashik Solar Traders',
      gstNo: null,
      phone: null,
      address: 'Nashik\nMaharashtra\nIndia',
    }]);

    const response = await POST(stockRequest({
      query: 'give me all customers from nashik',
      history: [],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.searchName).toBe('nashik');
    expect(body.searchMode).toBe('city');
    expect(body.customers).toHaveLength(1);
    expect(mocks.findCustomersByCity).toHaveBeenCalledWith('nashik', 7);
    expect(mocks.findCustomersByName).not.toHaveBeenCalled();
    expect(mocks.getAvailableStock).not.toHaveBeenCalled();
  });

  it('routes PI requests to the Odoo-grounded proforma assistant', async () => {
    mocks.isProformaAssistantRequest.mockReturnValue(true);
    mocks.resolveProformaAssistant.mockResolvedValue({
      kind: 'proforma', query: 'generate a pi', assistantMessage: 'Draft ready', fetchedAt: '2026-09-08T00:00:00.000Z', action: 'preview', draft: {},
    });

    const response = await POST(stockRequest({ query: 'generate a pi', history: [], proformaDraft: { lines: [] } }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.kind).toBe('proforma');
    expect(mocks.resolveProformaAssistant).toHaveBeenCalledWith({
      query: 'generate a pi', companyId: 7, draft: { lines: [] },
    });
    expect(mocks.getAvailableStock).not.toHaveBeenCalled();
  });
});

function stockRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/stock/assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function mockOpenAIPlan(productIds: number[]): void {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    status: 'completed',
    output: [{
      type: 'message',
      content: [{
        type: 'output_text',
        text: JSON.stringify({
          intent: 'lookup',
          requests: [{
            requested: 'Polycab 5 kW',
            interpretation: 'Polycab 5 kW inverter',
            status: 'matched',
            reason: 'Exact match.',
            matchedProductIds: productIds,
          }],
        }),
      }],
    }],
  })));
}

function product(id: number, sku: string, name: string): AvailableStockItem {
  return {
    id,
    sku,
    name,
    uom: 'Units',
    available: 10,
    onHand: 10,
    reserved: 0,
    incoming: 0,
    outgoing: 0,
    forecast: 10,
  };
}
