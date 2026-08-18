import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { legacyOdooRouteGuard } from '@/lib/auth/api-auth';
import { OdooApiError, OdooConfigurationError } from '@/lib/odoo/client';
import { getAvailableStock } from '@/lib/stock/service';
import { MAX_STOCK_QUERY_LENGTH } from '@/lib/stock/limits';

export async function GET(request: NextRequest) {
  const authError = await legacyOdooRouteGuard(request);
  if (authError) return authError;

  const query = new URL(request.url).searchParams.get('query')?.trim() ?? '';
  if (query.length > MAX_STOCK_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `Keep the stock request below ${MAX_STOCK_QUERY_LENGTH} characters.` },
      { status: 400 },
    );
  }

  try {
    const result = await getAvailableStock(query);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Available stock lookup failed:', error);
    if (error instanceof OdooConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (error instanceof OdooApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === 429 ? 429 : 502 },
      );
    }
    return NextResponse.json({ error: 'Could not fetch live Odoo stock.' }, { status: 500 });
  }
}
