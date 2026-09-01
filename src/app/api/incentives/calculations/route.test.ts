import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
  createDraftCalculation: vi.fn(),
  recalculate: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/incentives/api/service', () => ({
  IncentiveApiService: class {
    createDraftCalculation = serviceMocks.createDraftCalculation;
    recalculate = serviceMocks.recalculate;
  },
}));
vi.mock('@/lib/auth/odoo-identity', () => ({
  loadAuthenticatedActor: vi.fn(async () => ({
    userId: 2,
    name: 'API Administrator',
    login: 'admin@example.com',
    currentCompanyId: 1,
    companyIds: [1],
    roles: ['administrator'],
    employeeId: 1,
    employeeMapping: 'mapped',
  })),
}));

import { NextRequest } from 'next/server';
import { POST as createCalculation } from './route';
import { POST as recalculateCalculation } from './[id]/recalculate/route';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth/session';

beforeAll(() => {
  process.env.SESSION_SECRET = 'phase-5-5-test-session-secret-longer-than-32-characters';
});

beforeEach(() => {
  serviceMocks.createDraftCalculation.mockReset();
  serviceMocks.recalculate.mockReset();
});

async function authenticatedRequest(body?: unknown, options: { csrf?: boolean; token?: string } = {}) {
  const session = await createSessionToken(2);
  const headers = new Headers({
    cookie: `${SESSION_COOKIE_NAME}=${session.token}`,
    origin: 'http://localhost',
  });
  if (options.csrf !== false) headers.set('x-csrf-token', options.token ?? session.csrfToken);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest('http://localhost/api/incentives/calculations', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('POST /api/incentives/calculations', () => {
  it('returns calculation metadata for a valid authenticated request', async () => {
    serviceMocks.createDraftCalculation.mockResolvedValue({ calculationId: 42, unresolvedSources: [], preview: {} });

    const response = await createCalculation(await authenticatedRequest({ employeeId: 1, month: '2026-08' }));

    expect(response.status).toBe(200);
    expect(await responseBody(response)).toMatchObject({ calculationId: 42 });
    expect(serviceMocks.createDraftCalculation).toHaveBeenCalledWith(expect.objectContaining({ employeeId: 1, month: '2026-08' }));
  });

  it.each([
    ['missing employee', { month: '2026-08' }, 'Employee ID must be a positive integer'],
    ['invalid employee', { employeeId: 0, month: '2026-08' }, 'Employee ID must be a positive integer'],
    ['missing month', { employeeId: 1 }, 'Month is required'],
    ['invalid month', { employeeId: 1, month: '2026-13' }, 'Month must use YYYY-MM format'],
  ])('rejects %s', async (_label, body, message) => {
    const response = await createCalculation(await authenticatedRequest(body));

    expect(response.status).toBe(400);
    expect(await responseBody(response)).toMatchObject({ error: expect.stringContaining(message) });
    expect(serviceMocks.createDraftCalculation).not.toHaveBeenCalled();
  });

  it.each([
    ['missing assignment', 'Expected exactly one effective employee assignment, found 0'],
    ['inactive preset', 'Effective preset version is not active and locked'],
    ['Odoo failure', 'Odoo request failed while loading account.move'],
    ['persistence failure', 'Studio calculation create failed'],
  ])('returns an actionable 400 for %s', async (_label, message) => {
    serviceMocks.createDraftCalculation.mockRejectedValue(new Error(message));

    const response = await createCalculation(await authenticatedRequest({ employeeId: 1, month: '2026-08' }));

    expect(response.status).toBe(400);
    expect(await responseBody(response)).toEqual({ error: message });
  });

  it('returns unresolved source details without converting a valid draft into an error', async () => {
    serviceMocks.createDraftCalculation.mockResolvedValue({
      calculationId: 43,
      unresolvedSources: [{ type: 'commission_assignment', sourceId: 10 }],
      preview: {},
    });

    const response = await createCalculation(await authenticatedRequest({ employeeId: 1, month: '2026-08' }));

    expect(response.status).toBe(200);
    expect(await responseBody(response)).toMatchObject({
      calculationId: 43,
      unresolvedSources: [{ type: 'commission_assignment', sourceId: 10 }],
    });
  });

  it('rejects a request without a session', async () => {
    const request = new NextRequest('http://localhost/api/incentives/calculations', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ employeeId: 1, month: '2026-08' }),
    });

    const response = await createCalculation(request);

    expect(response.status).toBe(401);
    expect(await responseBody(response)).toEqual({ error: 'Authentication required' });
  });

  it('rejects a request without a valid CSRF token', async () => {
    const response = await createCalculation(await authenticatedRequest(
      { employeeId: 1, month: '2026-08' },
      { token: 'invalid' },
    ));

    expect(response.status).toBe(403);
    expect(await responseBody(response)).toEqual({ error: 'Invalid CSRF token' });
  });

  it.each([
    'Reviewer, approver, or administrator role required',
    'User 2 cannot access company 2',
  ])('returns 403 for authorization failure: %s', async (message) => {
    const error = new Error(message);
    error.name = 'IncentiveAuthorizationError';
    serviceMocks.createDraftCalculation.mockRejectedValue(error);

    const response = await createCalculation(await authenticatedRequest({ employeeId: 1, month: '2026-08' }));

    expect(response.status).toBe(403);
    expect(await responseBody(response)).toEqual({ error: message });
  });
});

describe('POST /api/incentives/calculations/:id/recalculate', () => {
  it('recalculates a valid draft', async () => {
    serviceMocks.recalculate.mockResolvedValue({ unresolvedSources: [] });
    const request = await authenticatedRequest();

    const response = await recalculateCalculation(request, { params: Promise.resolve({ id: '42' }) });

    expect(response.status).toBe(200);
    expect(serviceMocks.recalculate).toHaveBeenCalledWith(expect.anything(), 42);
  });

  it('rejects an invalid calculation state transition', async () => {
    serviceMocks.recalculate.mockRejectedValue(new Error('Calculation 42 cannot be recalculated from approved'));
    const request = await authenticatedRequest();

    const response = await recalculateCalculation(request, { params: Promise.resolve({ id: '42' }) });

    expect(response.status).toBe(400);
    expect(await responseBody(response)).toEqual({ error: 'Calculation 42 cannot be recalculated from approved' });
  });
});
