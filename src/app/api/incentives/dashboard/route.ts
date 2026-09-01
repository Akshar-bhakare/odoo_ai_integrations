import type { NextRequest } from 'next/server';
import { incentiveRoute } from '@/lib/api/incentive-route';
import { IncentiveApiService } from '@/lib/incentives/api/service';

const service = new IncentiveApiService();

export async function GET(request: NextRequest) {
  return incentiveRoute(request, {}, async (actor) => {
    // Keep these reads sequential. Odoo Online applies an IP-based request limit,
    // and a short burst is more likely to trigger it than the same small workload
    // spread across the lifetime of this request.
    const calculations = await service.listCalculations(actor);
    const employees = await service.listEmployees(actor);
    const presets = await service.listPresets(actor);
    const assignments = await service.listAssignments(actor);

    return { calculations, employees, presets, assignments };
  });
}
