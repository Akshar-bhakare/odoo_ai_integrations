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

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return incentiveRoute(request, { write: true }, async (actor) => {
    const { id } = await context.params;
    const body = await jsonObject(request);
    if (body.operation !== 'add' && body.operation !== 'deduct') {
      throw new Error('Adjustment operation must be add or deduct');
    }
    const adjustmentId = await repository.createAdjustment({
      actor,
      calculationId: integer(id, 'Calculation ID'),
      operation: body.operation,
      amount: money(body.amount, 'Amount'),
      reason: text(body.reason, 'Reason'),
      notes: optionalText(body.notes),
    });
    return { adjustmentId };
  });
}
