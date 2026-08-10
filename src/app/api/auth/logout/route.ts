import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  assertCsrf,
  assertSameOrigin,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  sessionFromRequest,
} from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  try {
    assertSameOrigin(request);
    assertCsrf(request, session);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Request rejected' },
      { status: 403 },
    );
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}
