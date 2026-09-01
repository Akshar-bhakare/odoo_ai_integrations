import type { NextRequest } from 'next/server';
import { incentiveRoute } from '@/lib/api/incentive-route';
import { IncentiveApiService } from '@/lib/incentives/api/service';

const service = new IncentiveApiService();

export async function GET(request: NextRequest) {
  return incentiveRoute(request, {}, (actor) => service.presetWorkspace(actor));
}
