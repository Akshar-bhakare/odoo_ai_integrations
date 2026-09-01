import type { NextRequest } from 'next/server';
import { IncentiveApiService } from '@/lib/incentives/api/service';
import { incentiveRoute, integer } from '@/lib/api/incentive-route';

const service = new IncentiveApiService();

export async function GET(request: NextRequest) {
  return incentiveRoute(request, {}, async (actor) => {
    const employeeId = request.nextUrl.searchParams.get('employeeId');
    const data = await service.employeeData(
      actor,
      employeeId ? integer(employeeId, 'Employee ID') : integer(actor.employeeId, 'Mapped employee ID'),
    );
    return data.customerIncentives;
  });
}
