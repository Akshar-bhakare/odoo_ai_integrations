import 'server-only';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadAuthenticatedActor } from './odoo-identity';
import {
  assertCsrf,
  assertSameOrigin,
  sessionFromRequest,
} from './session';
import type { AuthenticatedIncentiveActor } from './types';
import { OdooApiError } from '../odoo/client';

export class ApiAuthenticationError extends Error {
  readonly status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = 'ApiAuthenticationError';
    this.status = status;
  }
}

export async function requireAuthenticatedActor(
  request: NextRequest,
  options: { write?: boolean } = {},
): Promise<AuthenticatedIncentiveActor> {
  const session = await sessionFromRequest(request);
  if (!session) {
    throw new ApiAuthenticationError('Authentication required');
  }
  if (options.write) {
    try {
      assertSameOrigin(request);
      assertCsrf(request, session);
    } catch (error) {
      throw new ApiAuthenticationError(error instanceof Error ? error.message : 'Request rejected', 403);
    }
  }
  return loadAuthenticatedActor(session.userId);
}

export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiAuthenticationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error && error.name === 'IncentiveAuthorizationError') {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof OdooApiError && error.code === 429) {
    return NextResponse.json({ error: error.message }, { status: 429 });
  }
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function legacyOdooRouteGuard(
  request: NextRequest,
  options: { administrator?: boolean } = {},
): Promise<NextResponse | null> {
  try {
    const actor = await requireAuthenticatedActor(request);
    if (options.administrator && !actor.roles.includes('administrator')) {
      return NextResponse.json({ error: 'Administrator role required' }, { status: 403 });
    }
    return null;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
