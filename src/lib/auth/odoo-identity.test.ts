import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { OdooGateway } from '../incentives/odoo/gateway';
import { loadAuthenticatedActor } from './odoo-identity';

function gatewayWithEmployees(employeeIds: number[]): OdooGateway {
  return {
    searchRead: vi.fn(async () => [{
      id: 7,
      name: 'Test User',
      login: 'test@example.com',
      active: true,
      company_id: [1, 'Sunlectric'],
      company_ids: [1, 2],
      group_ids: [10, 11],
    }]),
    searchReadAll: vi.fn(async (model: string) => {
      if (model === 'res.groups') {
        return [
          { id: 10, name: 'Sunlectric Incentives / Reviewer' },
          { id: 11, name: 'Sunlectric Incentives / Approver' },
        ];
      }
      return employeeIds.map((id) => ({ id, company_id: [1, 'Sunlectric'] }));
    }),
    create: vi.fn(),
    write: vi.fn(),
    unlink: vi.fn(),
  } as unknown as OdooGateway;
}

describe('Odoo actor mapping', () => {
  it('derives company, roles, and the unique employee mapping server-side', async () => {
    const actor = await loadAuthenticatedActor(7, gatewayWithEmployees([100]));

    expect(actor).toMatchObject({
      userId: 7,
      currentCompanyId: 1,
      companyIds: [1, 2],
      roles: ['reviewer', 'approver'],
      employeeId: 100,
      employeeMapping: 'mapped',
    });
  });

  it('does not guess when the employee mapping is ambiguous', async () => {
    const actor = await loadAuthenticatedActor(7, gatewayWithEmployees([100, 101]));

    expect(actor.employeeId).toBeNull();
    expect(actor.employeeMapping).toBe('ambiguous');
  });
});
