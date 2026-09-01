import type { NextRequest } from 'next/server';
import { IncentiveApiService } from '@/lib/incentives/api/service';
import { calendarMonth, incentiveRoute, integer, jsonObject } from '@/lib/api/incentive-route';

const service = new IncentiveApiService();

export async function GET(request: NextRequest) {
  return incentiveRoute(request, {}, (actor) => {
    const employeeId = request.nextUrl.searchParams.get('employeeId');
    return service.listCalculations(actor, employeeId ? integer(employeeId, 'Employee ID') : undefined);
  });
}

export async function POST(request: NextRequest) {
  return incentiveRoute(request, { write: true }, async (actor) => {
    const body = await jsonObject(request);
    return service.createDraftCalculation({
      actor,
      employeeId: integer(body.employeeId, 'Employee ID'),
      month: calendarMonth(body.month),
    });
  });
}
