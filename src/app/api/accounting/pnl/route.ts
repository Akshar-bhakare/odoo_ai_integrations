import type { NextRequest } from 'next/server';
import { incentiveRoute } from '@/lib/api/incentive-route';
import { assertReviewerScope } from '@/lib/auth/incentive-access';
import { fetchPnlJournalItems } from '@/lib/accounting/pnl';
import { defaultOdooGateway } from '@/lib/incentives/odoo/gateway';

function isoDate(value: string | null, label: string): string {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid date`);
  }
  return value;
}

export async function GET(request: NextRequest) {
  return incentiveRoute(request, {}, async (actor) => {
    assertReviewerScope(actor);
    const dateFrom = isoDate(request.nextUrl.searchParams.get('dateFrom'), 'Start date');
    const dateTo = isoDate(request.nextUrl.searchParams.get('dateTo'), 'End date');
    if (dateFrom > dateTo) throw new Error('Start date must be on or before end date');
    const rawPage = request.nextUrl.searchParams.get('page') ?? '1';
    if (!/^\d+$/.test(rawPage) || Number(rawPage) < 1) {
      throw new Error('Page must be a positive integer');
    }
    return fetchPnlJournalItems({
      gateway: defaultOdooGateway,
      companyId: actor.currentCompanyId,
      dateFrom,
      dateTo,
      page: Number(rawPage),
    });
  });
}
