import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getAvailableStock: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/api-auth', () => ({
  legacyOdooRouteGuard: vi.fn(async () => null),
}));
vi.mock('@/lib/stock/service', () => ({ getAvailableStock: mocks.getAvailableStock }));

import { NextRequest } from 'next/server';
import { GET } from './route';
import { MAX_STOCK_QUERY_LENGTH } from '@/lib/stock/limits';

beforeEach(() => {
  mocks.getAvailableStock.mockReset();
  mocks.getAvailableStock.mockResolvedValue({
    spokenQuery: '',
    searchTerms: [],
    fetchedAt: '2026-09-05T00:00:00.000Z',
    products: [],
  });
});

describe('GET /api/stock/available', () => {
  it('accepts compatibility queries longer than the retired 160-character limit', async () => {
    const query = `${'Polycab stock request '.repeat(10)}5 kW`;
    const request = new NextRequest(
      `http://localhost/api/stock/available?query=${encodeURIComponent(query)}`,
    );

    const response = await GET(request);

    expect(query.length).toBeGreaterThan(160);
    expect(response.status).toBe(200);
    expect(mocks.getAvailableStock).toHaveBeenCalledWith(query);
  });

  it('uses the same maximum query length as the assistant and client', async () => {
    const query = 'x'.repeat(MAX_STOCK_QUERY_LENGTH + 1);
    const request = new NextRequest(
      `http://localhost/api/stock/available?query=${encodeURIComponent(query)}`,
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(mocks.getAvailableStock).not.toHaveBeenCalled();
  });
});
