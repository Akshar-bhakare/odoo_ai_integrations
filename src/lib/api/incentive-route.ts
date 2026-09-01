import 'server-only';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { apiErrorResponse, requireAuthenticatedActor } from '../auth/api-auth';
import type { AuthenticatedIncentiveActor } from '../auth/types';

export async function incentiveRoute(
  request: NextRequest,
  options: { write?: boolean },
  handler: (actor: AuthenticatedIncentiveActor) => Promise<unknown>,
): Promise<NextResponse> {
  try {
    const actor = await requireAuthenticatedActor(request, options);
    const result = await handler(actor);
    return result instanceof NextResponse ? result : NextResponse.json(result ?? { success: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function jsonObject(request: NextRequest): Promise<Record<string, unknown>> {
  const value: unknown = await request.json();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('JSON object body required');
  }
  return value as Record<string, unknown>;
}

export function integer(value: unknown, label: string): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(parsed) || Number(parsed) <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number(parsed);
}

export function text(value: unknown, label: string, maxLength = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} is required and must not exceed ${maxLength} characters`);
  }
  return value.trim();
}

export function calendarMonth(value: unknown, label = 'Month'): string {
  const month = text(value, label, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`${label} must use YYYY-MM format`);
  }
  return month;
}

export function optionalText(value: unknown, maxLength = 4000): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return text(value, 'Text', maxLength);
}

export function money(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}
