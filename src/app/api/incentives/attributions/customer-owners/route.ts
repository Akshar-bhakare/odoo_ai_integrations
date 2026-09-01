import type { NextRequest } from 'next/server';
import { StudioIncentiveRepository } from '@/lib/incentives/odoo/studio-repository';
import {
  incentiveRoute,
  integer,
  jsonObject,
  optionalText,
  text,
} from '@/lib/api/incentive-route';

const repository = new StudioIncentiveRepository();

export async function POST(request: NextRequest) {
  return incentiveRoute(request, { write: true }, async (actor) => {
    const body = await jsonObject(request);
    const resolutionId = await repository.resolveCustomerOwner({
      actor,
      eventKey: text(body.eventKey, 'Customer event key', 300),
      employeeId: integer(body.employeeId, 'Employee ID'),
      companyId: actor.currentCompanyId,
      reason: text(body.reason, 'Reason'),
      notes: optionalText(body.notes),
    });
    return { resolutionId };
  });
}
