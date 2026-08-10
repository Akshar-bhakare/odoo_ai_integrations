import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  authenticateOdooCredentials,
  loadAuthenticatedActor,
  OdooAuthenticationError,
} from '@/lib/auth/odoo-identity';
import {
  assertLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
} from '@/lib/auth/rate-limit';
import {
  assertSameOrigin,
  createSessionToken,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from '@/lib/auth/session';
import { OdooApiError } from '@/lib/odoo/client';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body.login !== 'string' || typeof body.password !== 'string') {
      return NextResponse.json({ error: 'Login and password are required' }, { status: 400 });
    }
    const login = body.login.trim();
    if (!login || !body.password || login.length > 254 || body.password.length > 1024) {
      return NextResponse.json({ error: 'Invalid login request' }, { status: 400 });
    }
    const clientAddress = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
      ?? request.headers.get('x-real-ip')
      ?? 'unknown';
    const rateLimitKey = `${clientAddress}:${login.toLowerCase()}`;
    assertLoginAllowed(rateLimitKey);
    let userId: number;
    try {
      userId = await authenticateOdooCredentials(login, body.password);
    } catch (error) {
      recordLoginFailure(rateLimitKey);
      if (error instanceof OdooAuthenticationError) {
        return NextResponse.json({ error: 'Invalid Odoo login or password' }, { status: 401 });
      }
      throw error;
    }
    const actor = await loadAuthenticatedActor(userId);
    clearLoginFailures(rateLimitKey);
    const session = await createSessionToken(userId);
    const response = NextResponse.json({
      actor: publicActor(actor),
      csrfToken: session.csrfToken,
    });
    response.cookies.set(SESSION_COOKIE_NAME, session.token, sessionCookieOptions());
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';
    const status = error instanceof OdooApiError && error.code === 429
      ? 429
      : message.startsWith('Too many login attempts') ? 429 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

function publicActor(actor: Awaited<ReturnType<typeof loadAuthenticatedActor>>) {
  return {
    name: actor.name,
    login: actor.login,
    currentCompanyId: actor.currentCompanyId,
    employeeId: actor.employeeId,
    employeeMapping: actor.employeeMapping,
    roles: actor.roles,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
