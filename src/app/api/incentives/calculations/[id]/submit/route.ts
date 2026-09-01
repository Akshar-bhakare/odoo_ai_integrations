import type { NextRequest } from 'next/server';
import { IncentiveApiService } from '@/lib/incentives/api/service';
import { incentiveRoute, integer } from '@/lib/api/incentive-route';

const service = new IncentiveApiService();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return incentiveRoute(request, { write: true }, async (actor) => {
    const { id } = await context.params;
    await service.submit(actor, integer(id, 'Calculation ID'));
    return { success: true };
  });
}
