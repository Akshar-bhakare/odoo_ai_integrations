import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./odoo-identity', () => ({
  loadAuthenticatedActor: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { ApiAuthenticationError, requireAuthenticatedActor } from './api-auth';
import { createSessionToken, SESSION_COOKIE_NAME } from './session';

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-session-secret-that-is-longer-than-32-characters';
});

describe('authenticated API guard', () => {
  it('rejects an unauthenticated request', async () => {
    const request = new NextRequest('http://localhost/api/incentives/calculations');

    await expect(requireAuthenticatedActor(request)).rejects.toMatchObject({
      name: 'ApiAuthenticationError',
      status: 401,
    } satisfies Partial<ApiAuthenticationError>);
  });

  it('rejects a write without the session CSRF token', async () => {
    const created = await createSessionToken(42);
    const request = new NextRequest('http://localhost/api/incentives/calculations', {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${created.token}` },
    });

    await expect(requireAuthenticatedActor(request, { write: true })).rejects.toMatchObject({
      name: 'ApiAuthenticationError',
      status: 403,
    } satisfies Partial<ApiAuthenticationError>);
  });
});
