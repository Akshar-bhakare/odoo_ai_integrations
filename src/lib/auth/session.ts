import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import type { SessionClaims } from './types';

export const SESSION_COOKIE_NAME = 'sunlectric_session';
export const SESSION_DURATION_SECONDS = 8 * 60 * 60;

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters');
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(userId: number): Promise<{
  token: string;
  csrfToken: string;
}> {
  const csrfToken = crypto.randomUUID();
  const token = await new SignJWT({ csrf: csrfToken })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(secretKey());
  return { token, csrfToken };
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId)
      || typeof payload.csrf !== 'string'
      || typeof payload.iat !== 'number'
      || typeof payload.exp !== 'number') {
      return null;
    }
    return {
      userId,
      csrfToken: payload.csrf,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

export async function sessionFromRequest(request: NextRequest): Promise<SessionClaims | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return token ? verifySessionToken(token) : null;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: SESSION_DURATION_SECONDS,
    priority: 'high' as const,
  };
}

function equalSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw new Error('Cross-origin request rejected');
  }
}

export function assertCsrf(request: NextRequest, session: SessionClaims): void {
  const supplied = request.headers.get('x-csrf-token');
  if (!supplied || !equalSecret(supplied, session.csrfToken)) {
    throw new Error('Invalid CSRF token');
  }
}
