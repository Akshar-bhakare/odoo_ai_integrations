import type { NextRequest } from 'next/server';
import { incentiveRoute, text } from '@/lib/api/incentive-route';
import { IncentiveApiService } from '@/lib/incentives/api/service';

const service = new IncentiveApiService();

export async function GET(request: NextRequest) {
  return incentiveRoute(request, {}, async (actor) => {
    const month = text(request.nextUrl.searchParams.get('month'), 'Month', 7);
    const unresolved = await service.unresolvedDetails(actor, month, [
      'employee_expense',
      'expense_assignment_conflict',
      'commission_assignment',
      'customer_owner',
    ]);
    const employees = await service.listEmployees(actor);

    return {
      expenses: unresolved.filter((item) => (
        item.type === 'employee_expense' || item.type === 'expense_assignment_conflict'
      )),
      commissions: unresolved.filter((item) => item.type === 'commission_assignment'),
      owners: unresolved.filter((item) => item.type === 'customer_owner'),
      employees,
    };
  });
}
