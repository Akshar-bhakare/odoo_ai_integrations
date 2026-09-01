import type { NextRequest } from 'next/server';
import { IncentiveApiService } from '@/lib/incentives/api/service';
import { incentiveRoute } from '@/lib/api/incentive-route';

const service = new IncentiveApiService();

export async function GET(request: NextRequest) {
  return incentiveRoute(request, {}, (actor) => service.listEmployees(actor));
}
