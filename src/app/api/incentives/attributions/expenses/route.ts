import type { NextRequest } from 'next/server';
import { StudioIncentiveRepository } from '@/lib/incentives/odoo/studio-repository';
import {
  incentiveRoute,
  integer,
  jsonObject,
  money,
  optionalText,
  text,
} from '@/lib/api/incentive-route';

const repository = new StudioIncentiveRepository();

export async function POST(request: NextRequest) {
  return incentiveRoute(request, { write: true }, async (actor) => {
    const body = await jsonObject(request);
    const assignmentId = await repository.assignExpense({
      actor,
      moveId: integer(body.moveId, 'Accounting move ID'),
      employeeId: integer(body.employeeId, 'Employee ID'),
      attributedAmount: money(body.attributedAmount, 'Attributed amount'),
      reason: text(body.reason, 'Reason'),
      notes: optionalText(body.notes),
    });
    return { assignmentId };
  });
}
