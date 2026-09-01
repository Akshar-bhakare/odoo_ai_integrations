import type { NextRequest } from 'next/server';
import type { IncentivePresetV1 } from '@/lib/incentives/types';
import { IncentiveApiService } from '@/lib/incentives/api/service';
import { StudioIncentiveRepository } from '@/lib/incentives/odoo/studio-repository';
import { incentiveRoute, integer, jsonObject } from '@/lib/api/incentive-route';

const service = new IncentiveApiService();
const repository = new StudioIncentiveRepository();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return incentiveRoute(request, {}, async (actor) => {
    const { id } = await context.params;
    return service.getPresetVersion(actor, integer(id, 'Preset version ID'));
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return incentiveRoute(request, { write: true }, async (actor) => {
    const { id } = await context.params;
    const body = await jsonObject(request);
    await repository.updateDraftPresetVersion({
      actor,
      versionId: integer(id, 'Preset version ID'),
      rules: body.rules as IncentivePresetV1,
    });
    return { success: true };
  });
}
