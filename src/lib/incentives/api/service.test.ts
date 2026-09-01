import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

import { paymentSummary } from './payment';
import { IncentiveApiService } from './service';
import type { AuthenticatedIncentiveActor } from '../../auth/types';
import type { OdooGateway } from '../odoo/gateway';

describe('paymentSummary', () => {
  it('derives settlement state from payment records', () => {
    expect(paymentSummary(1000, [])).toEqual({ paidAmount: 0, paymentState: 'unpaid' });
    expect(paymentSummary(1000, [{ x_amount: 250 }])).toEqual({ paidAmount: 250, paymentState: 'partial' });
    expect(paymentSummary(1000, [{ x_amount: 250 }, { x_amount: 750 }])).toEqual({
      paidAmount: 1000,
      paymentState: 'paid',
    });
  });
});

describe('calculation list scope', () => {
  function setup() {
    const searchReadAll = vi.fn().mockResolvedValue([]);
    const gateway = {
      searchRead: vi.fn(),
      searchReadAll,
      create: vi.fn(),
      write: vi.fn(),
      unlink: vi.fn(),
    } as unknown as OdooGateway;
    const actor: AuthenticatedIncentiveActor = {
      userId: 2,
      name: 'Administrator',
      login: 'admin@example.com',
      currentCompanyId: 1,
      companyIds: [1],
      roles: ['administrator'],
      employeeId: 1,
      employeeMapping: 'mapped',
    };
    return { service: new IncentiveApiService(gateway), searchReadAll, actor };
  }

  it('does not restrict a company-wide administrator to their own employee record', async () => {
    const { service, searchReadAll, actor } = setup();

    await service.listCalculations(actor);

    expect(searchReadAll.mock.calls[0][1]).toEqual([['x_company_id', '=', 1]]);
  });

  it('applies an explicit employee filter for a company-wide administrator', async () => {
    const { service, searchReadAll, actor } = setup();

    await service.listCalculations(actor, 8);

    expect(searchReadAll.mock.calls[0][1]).toEqual([
      ['x_company_id', '=', 1],
      ['x_employee_id', '=', 8],
    ]);
  });
});
