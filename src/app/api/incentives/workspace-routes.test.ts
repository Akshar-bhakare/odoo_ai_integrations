import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
  dashboard: {
    listCalculations: vi.fn(),
    listEmployees: vi.fn(),
    listPresets: vi.fn(),
    listAssignments: vi.fn(),
  },
  assignmentWorkspace: vi.fn(),
  calculationWorkbench: vi.fn(),
  presetWorkspace: vi.fn(),
  unresolvedDetails: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/incentives/api/service', () => ({
  IncentiveApiService: class {
    listCalculations = serviceMocks.dashboard.listCalculations;
    listEmployees = serviceMocks.dashboard.listEmployees;
    listPresets = serviceMocks.dashboard.listPresets;
    listAssignments = serviceMocks.dashboard.listAssignments;
    assignmentWorkspace = serviceMocks.assignmentWorkspace;
    calculationWorkbench = serviceMocks.calculationWorkbench;
    presetWorkspace = serviceMocks.presetWorkspace;
    unresolvedDetails = serviceMocks.unresolvedDetails;
  },
}));
vi.mock('@/lib/auth/odoo-identity', () => ({
  loadAuthenticatedActor: vi.fn(async () => ({
    userId: 2,
    name: 'API Administrator',
    login: 'admin@example.com',
    currentCompanyId: 1,
    companyIds: [1],
    roles: ['administrator'],
    employeeId: 1,
    employeeMapping: 'mapped',
  })),
}));

import { NextRequest } from 'next/server';
import { GET as dashboard } from './dashboard/route';
import { GET as assignmentWorkspace } from './assignments/workspace/route';
import { GET as calculationWorkbench } from './calculations/[id]/workbench/route';
import { GET as presetWorkspace } from './presets/workspace/route';
import { GET as unresolvedWorkbench } from './unresolved/workbench/route';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth/session';

beforeAll(() => {
  process.env.SESSION_SECRET = 'workspace-route-test-secret-longer-than-32-characters';
});

beforeEach(() => {
  vi.clearAllMocks();
  serviceMocks.dashboard.listCalculations.mockResolvedValue([]);
  serviceMocks.dashboard.listEmployees.mockResolvedValue([]);
  serviceMocks.dashboard.listPresets.mockResolvedValue([]);
  serviceMocks.dashboard.listAssignments.mockResolvedValue([]);
  serviceMocks.assignmentWorkspace.mockResolvedValue({ assignments: [], employees: [], versions: [] });
  serviceMocks.calculationWorkbench.mockResolvedValue({ calculation: { id: 42 }, sources: [], employees: [] });
  serviceMocks.presetWorkspace.mockResolvedValue({ presets: [], versions: [] });
  serviceMocks.unresolvedDetails.mockResolvedValue([]);
});

async function request(path: string) {
  const session = await createSessionToken(2);
  return new NextRequest(`http://localhost${path}`, {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${session.token}` },
  });
}

describe('consolidated workspace routes', () => {
  it('loads dashboard data through one route and one actor resolution', async () => {
    const response = await dashboard(await request('/api/incentives/dashboard'));

    expect(response.status).toBe(200);
    expect(serviceMocks.dashboard.listCalculations).toHaveBeenCalledOnce();
    expect(serviceMocks.dashboard.listEmployees).toHaveBeenCalledOnce();
    expect(serviceMocks.dashboard.listPresets).toHaveBeenCalledOnce();
    expect(serviceMocks.dashboard.listAssignments).toHaveBeenCalledOnce();
  });

  it('delegates assignment setup to one workspace service call', async () => {
    const response = await assignmentWorkspace(await request('/api/incentives/assignments/workspace'));

    expect(response.status).toBe(200);
    expect(serviceMocks.assignmentWorkspace).toHaveBeenCalledOnce();
  });

  it('delegates calculation detail to one workspace service call', async () => {
    const response = await calculationWorkbench(
      await request('/api/incentives/calculations/42/workbench'),
      { params: Promise.resolve({ id: '42' }) },
    );

    expect(response.status).toBe(200);
    expect(serviceMocks.calculationWorkbench).toHaveBeenCalledWith(expect.any(Object), 42);
  });

  it('delegates preset setup to one workspace service call', async () => {
    const response = await presetWorkspace(await request('/api/incentives/presets/workspace'));

    expect(response.status).toBe(200);
    expect(serviceMocks.presetWorkspace).toHaveBeenCalledOnce();
  });

  it('extracts unresolved sources once for all displayed categories', async () => {
    const response = await unresolvedWorkbench(
      await request('/api/incentives/unresolved/workbench?month=2026-09'),
    );

    expect(response.status).toBe(200);
    expect(serviceMocks.unresolvedDetails).toHaveBeenCalledWith(
      expect.any(Object),
      '2026-09',
      ['employee_expense', 'expense_assignment_conflict', 'commission_assignment', 'customer_owner'],
    );
  });
});
