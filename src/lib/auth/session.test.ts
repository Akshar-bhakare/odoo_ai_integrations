import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { NextRequest } from 'next/server';
import {
  assertCsrf,
  createSessionToken,
  SESSION_COOKIE_NAME,
  sessionFromRequest,
  verifySessionToken,
} from './session';

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-session-secret-that-is-longer-than-32-characters';
});

describe('signed application sessions', () => {
  it('round-trips a signed Odoo user identity', async () => {
    const created = await createSessionToken(42);
    const claims = await verifySessionToken(created.token);

    expect(claims?.userId).toBe(42);
    expect(claims?.csrfToken).toBe(created.csrfToken);
  });

  it('rejects a tampered session token', async () => {
    const created = await createSessionToken(42);

    expect(await verifySessionToken(`${created.token}tampered`)).toBeNull();
  });

  it('reads the session cookie and enforces CSRF on writes', async () => {
    const created = await createSessionToken(42);
    const request = new NextRequest('http://localhost/api/incentives/calculations', {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${created.token}`,
        'x-csrf-token': created.csrfToken,
      },
    });
    const claims = await sessionFromRequest(request);

    expect(claims?.userId).toBe(42);
    expect(() => assertCsrf(request, claims!)).not.toThrow();
  });
});
