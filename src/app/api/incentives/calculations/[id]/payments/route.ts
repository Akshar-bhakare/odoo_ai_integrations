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
    const mode = text(body.mode, 'Payment mode', 80);
    const notes = optionalText(body.notes);
    const paymentId = await repository.recordPayment({
      actor,
      calculationId: integer(id, 'Calculation ID'),
      amount: money(body.amount, 'Amount'),
      paymentDate: text(body.paymentDate, 'Payment date', 10),
      reference: text(body.reference, 'Reference', 200),
      notes: notes ? `Mode: ${mode}\n${notes}` : `Mode: ${mode}`,
    });
    return { paymentId };
  });
}
