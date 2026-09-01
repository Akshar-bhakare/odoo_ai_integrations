import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { makeInput, newCustomerEvent } from '../test-helpers';
import type { UnresolvedIncentiveSource } from './contracts';
import { calculationAccountingSources, calculationBlockingSources } from './service';
import { IncentiveApiService } from '../api/service';
import type { OdooGateway } from './gateway';
import type { AuthenticatedIncentiveActor } from '@/lib/auth/types';

const reviewer: AuthenticatedIncentiveActor = {
  userId: 2,
  name: 'Reviewer',
  login: 'reviewer@example.com',
  currentCompanyId: 1,
  companyIds: [1],
  roles: ['reviewer'],
  employeeId: 8,
  employeeMapping: 'mapped',
};

describe('calculationBlockingSources', () => {
  it('keeps monthly accounting gaps and only relevant customer-owner gaps', () => {
    const input = makeInput({
      customerEvents: [
        newCustomerEvent({ id: 'current-qualifying', customerId: 1, pending: true }),
        newCustomerEvent({
          id: 'historical-qualifying',
          customerId: 2,
          eventDate: '2025-01-01',
          pending: true,
        }),
        newCustomerEvent({
          id: 'current-nonqualifying',
          customerId: 3,
          billing: 100000,
          pending: true,
        }),
      ],
    });
    const unresolved: UnresolvedIncentiveSource[] = [
      {
        type: 'commission_assignment',
        sourceModel: 'account.move.line',
        sourceId: 10,
        message: 'Unassigned commission',
      },
      ...['current-qualifying', 'historical-qualifying', 'current-nonqualifying'].map((eventKey, index) => ({
        type: 'customer_owner' as const,
        sourceModel: 'res.partner',
        sourceId: index + 1,
        eventKey,
        message: `Pending ${eventKey}`,
      })),
    ];

    expect(calculationBlockingSources(input, unresolved)).toEqual([
      unresolved[0],
      unresolved[1],
    ]);
  });

  it('does not let another known Odoo salesperson block this employee', () => {
    const input = makeInput();
    const unresolved: UnresolvedIncentiveSource[] = [
      {
        type: 'salesperson_employee',
        sourceModel: 'account.move',
        sourceId: 8525,
        sourceUserId: 24,
        message: 'Invoice has no salesperson employee mapping',
      },
      {
        type: 'salesperson_employee',
        sourceModel: 'account.move',
        sourceId: 9000,
        sourceUserId: null,
        message: 'Invoice has no salesperson',
      },
    ];

    expect(calculationBlockingSources(input, unresolved)).toEqual([unresolved[1]]);
  });

  it('keeps legacy salesperson issues conservative when user attribution is absent', () => {
    const input = makeInput();
    const unresolved: UnresolvedIncentiveSource[] = [{
      type: 'salesperson_employee',
      sourceModel: 'account.move',
      sourceId: 9001,
      message: 'Legacy unresolved salesperson issue',
    }];

    expect(calculationBlockingSources(input, unresolved)).toEqual(unresolved);
  });
});

describe('calculationAccountingSources', () => {
  it('keeps only the calculated employee and period', () => {
    const sources = [
      { sourceModel: 'account.move' as const, sourceId: 1, moveId: 1, employeeId: 8, month: '2026-08', category: 'sales' as const, signedAmount: 100 },
      { sourceModel: 'account.move' as const, sourceId: 2, moveId: 2, employeeId: 9, month: '2026-08', category: 'sales' as const, signedAmount: 200 },
      { sourceModel: 'account.move' as const, sourceId: 3, moveId: 3, employeeId: 8, month: '2026-07', category: 'cogs' as const, signedAmount: 50 },
    ];

    expect(calculationAccountingSources(sources, 8, '2026-08-01', '2026-08-31')).toEqual([
      sources[0],
    ]);
  });
});

describe('calculation preview flow', () => {
  it('refreshes and opens an existing draft instead of returning a duplicate error', async () => {
    const gateway = {
      searchReadAll: vi.fn(async () => [{ id: 42, x_revision: 1, x_state: 'draft' }]),
    } as unknown as OdooGateway;
    const service = new IncentiveApiService(gateway, {} as never);
    const recalculate = vi.spyOn(service, 'recalculate').mockResolvedValue({ unresolvedSources: [] });

    await expect(service.createDraftCalculation({ actor: reviewer, employeeId: 8, month: '2026-08' }))
      .resolves.toMatchObject({ calculationId: 42, reused: true });
    expect(recalculate).toHaveBeenCalledWith(reviewer, 42);
  });

  it('opens an existing submitted review without resetting it to draft', async () => {
    const gateway = {
      searchReadAll: vi.fn(async () => [{ id: 43, x_revision: 1, x_state: 'review' }]),
    } as unknown as OdooGateway;
    const service = new IncentiveApiService(gateway, {} as never);
    const recalculate = vi.spyOn(service, 'recalculate');

    await expect(service.createDraftCalculation({ actor: reviewer, employeeId: 8, month: '2026-08' }))
      .resolves.toMatchObject({ calculationId: 43, reused: true });
    expect(recalculate).not.toHaveBeenCalled();
  });
});
