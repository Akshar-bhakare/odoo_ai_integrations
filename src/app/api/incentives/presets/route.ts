import type { IncentivePresetV1 } from '@/lib/incentives/types';
import { IncentiveApiService } from '@/lib/incentives/api/service';
import { StudioIncentiveRepository } from '@/lib/incentives/odoo/studio-repository';
import {
  incentiveRoute,
  jsonObject,
  text,
} from '@/lib/api/incentive-route';
import type { NextRequest } from 'next/server';

const service = new IncentiveApiService();
const repository = new StudioIncentiveRepository();

export async function GET(request: NextRequest) {
  return incentiveRoute(request, {}, (actor) => service.listPresets(actor));
}

export async function POST(request: NextRequest) {
  return incentiveRoute(request, { write: true }, async (actor) => {
    const body = await jsonObject(request);
    const code = text(body.code, 'Code', 80);
    if (!/^[A-Z][A-Z0-9_]*$/.test(code)) throw new Error('Invalid preset code');
    const presetId = await repository.createPreset({
      actor,
      name: text(body.name, 'Name', 200),
      code,
      companyId: actor.currentCompanyId,
    });
    if (body.rules !== undefined) {
      const versionId = await repository.createPresetVersion({
        actor,
        presetId,
        versionNumber: 1,
        rules: body.rules as IncentivePresetV1,
      });
      return { presetId, versionId };
    }
    return { presetId };
  });
}
