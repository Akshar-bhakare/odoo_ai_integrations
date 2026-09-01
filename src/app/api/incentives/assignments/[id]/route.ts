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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return incentiveRoute(request, { write: true }, async (actor) => {
    const { id } = await context.params;
    const body = await jsonObject(request);
    const effectiveFrom = text(body.effectiveFrom, 'Effective from', 10);
    const effectiveTo = optionalText(body.effectiveTo, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)
      || (effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo))) {
      throw new Error('Assignment dates must use YYYY-MM-DD format');
    }
    await repository.updateEmployeePresetAssignment({
      actor,
      assignmentId: integer(id, 'Assignment ID'),
      presetVersionId: body.presetVersionId === undefined
        ? undefined
        : integer(body.presetVersionId, 'Preset version ID'),
      effectiveFrom,
      effectiveTo,
      active: body.active !== false,
    });
    return { success: true };
  });
}
