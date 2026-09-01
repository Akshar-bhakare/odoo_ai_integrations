import type { NextRequest } from 'next/server';
import { IncentiveApiService } from '@/lib/incentives/api/service';
import { StudioIncentiveRepository } from '@/lib/incentives/odoo/studio-repository';
import {
  incentiveRoute,
  integer,
  jsonObject,
  optionalText,
  text,
} from '@/lib/api/incentive-route';

const service = new IncentiveApiService();
const repository = new StudioIncentiveRepository();

export async function GET(request: NextRequest) {
  return incentiveRoute(request, {}, (actor) => service.listAssignments(actor));
}

export async function POST(request: NextRequest) {
  return incentiveRoute(request, { write: true }, async (actor) => {
    const body = await jsonObject(request);
    const effectiveFrom = text(body.effectiveFrom, 'Effective from', 10);
    const effectiveTo = optionalText(body.effectiveTo, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)
      || (effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo))) {
      throw new Error('Assignment dates must use YYYY-MM-DD format');
    }
    const assignmentId = await repository.assignEmployeePreset({
      actor,
      employeeId: integer(body.employeeId, 'Employee ID'),
      presetVersionId: integer(body.presetVersionId, 'Preset version ID'),
      companyId: actor.currentCompanyId,
      effectiveFrom,
      effectiveTo,
    });
    return { assignmentId };
  });
}
