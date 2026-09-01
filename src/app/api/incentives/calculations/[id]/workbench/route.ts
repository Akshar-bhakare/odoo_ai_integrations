import type { NextRequest } from 'next/server';
import { incentiveRoute, integer } from '@/lib/api/incentive-route';
import { IncentiveApiService } from '@/lib/incentives/api/service';

const service = new IncentiveApiService();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return incentiveRoute(request, {}, async (actor) => {
    const { id } = await context.params;
    return service.calculationWorkbench(actor, integer(id, 'Calculation ID'));
  });
}
