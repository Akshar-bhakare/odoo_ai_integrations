import type { NextRequest } from 'next/server';
import { StudioIncentiveRepository } from '@/lib/incentives/odoo/studio-repository';
import { incentiveRoute, integer } from '@/lib/api/incentive-route';

const repository = new StudioIncentiveRepository();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return incentiveRoute(request, { write: true }, async (actor) => {
    const { id } = await context.params;
    await repository.activatePresetVersion({
      actor,
      versionId: integer(id, 'Preset version ID'),
    });
    return { success: true };
  });
}
