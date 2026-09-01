import type { NextRequest } from 'next/server';
import { IncentiveApiService } from '@/lib/incentives/api/service';
import { incentiveRoute, text } from '@/lib/api/incentive-route';

const service = new IncentiveApiService();

export async function GET(request: NextRequest) {
  return incentiveRoute(request, {}, async (actor) => {
    const month = text(request.nextUrl.searchParams.get('month'), 'Month', 7);
    return service.unresolvedDetails(actor, month, ['customer_owner']);
  });
}
