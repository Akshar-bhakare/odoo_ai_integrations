import type { NextRequest } from 'next/server';
import type { IncentivePresetV1 } from '@/lib/incentives/types';
import { StudioIncentiveRepository } from '@/lib/incentives/odoo/studio-repository';
import { IncentiveApiService } from '@/lib/incentives/api/service';
import { incentiveRoute, integer, jsonObject } from '@/lib/api/incentive-route';

const repository = new StudioIncentiveRepository();
const service = new IncentiveApiService();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return incentiveRoute(request, {}, async (actor) => {
    const { id } = await context.params;
    return service.listPresetVersions(actor, integer(id, 'Preset ID'));
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return incentiveRoute(request, { write: true }, async (actor) => {
    const { id } = await context.params;
    const body = await jsonObject(request);
    const versionId = await repository.createPresetVersion({
      actor,
      presetId: integer(id, 'Preset ID'),
      versionNumber: integer(body.versionNumber, 'Version number'),
      rules: body.rules as IncentivePresetV1,
    });
    return { versionId };
  });
}
