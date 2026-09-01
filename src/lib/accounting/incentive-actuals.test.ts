import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { OdooGateway } from '@/lib/incentives/odoo/gateway';
import { fetchIncentiveActuals } from './incentive-actuals';

describe('incentive actuals', () => {
  it('groups P&L lines by invoice and deducts sales-order transport and loading', async () => {
    const searchReadAll = vi.fn(async (model: string) => {
      if (model === 'account.move.line') return [
        {
          id: 1,
          move_id: [9290, 'SL/FY26-27/779'],
          date: '2026-08-22',
          move_name: 'SL/FY26-27/779',
          account_id: [10, '50103000 Sales Income - Material'],
          partner_id: [20, 'Adhiraj Urja Solar Soluation'],
          debit: 0,
          credit: 94095,
          sale_line_ids: [30],
        },
        {
          id: 2,
          move_id: [9290, 'SL/FY26-27/779'],
          date: '2026-08-22',
          move_name: 'SL/FY26-27/779',
          account_id: [11, '60101000 Cost of Goods Sold'],
          partner_id: [20, 'Adhiraj Urja Solar Soluation'],
          debit: 86100,
          credit: 0,
          sale_line_ids: [],
        },
      ];
      if (model === 'account.move') return [{ id: 9290, move_type: 'out_invoice', invoice_user_id: [52, 'ANAM BANO'] }];
      if (model === 'sale.order.line') return [{ id: 30, order_id: [1918, 'S01918'], salesman_id: [52, 'ANAM BANO'] }];
      if (model === 'sale.order') return [{
        id: 1918,
        name: 'S01918',
        user_id: [52, 'ANAM BANO'],
        invoice_ids: [9290],
        x_studio_transport_charges: 1000,
        x_studio_loading_charges: 500,
      }];
      return [];
    });
    const gateway = {
      searchReadAll,
      searchCount: vi.fn(),
      searchRead: vi.fn(),
      create: vi.fn(),
      write: vi.fn(),
      unlink: vi.fn(),
    } as OdooGateway;

    const result = await fetchIncentiveActuals({
      gateway,
      companyId: 1,
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      salesperson: 'ANAM BANO',
      page: 1,
    });

    expect(searchReadAll).toHaveBeenNthCalledWith(1, 'account.move.line', [
      ['company_id', '=', 1],
      ['parent_state', '=', 'posted'],
      ['date', '>=', '2026-08-01'],
      ['date', '<=', '2026-08-31'],
      ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
      ['account_id.account_type', 'in', ['income', 'income_other', 'expense', 'expense_depreciation', 'expense_direct_cost']],
    ], expect.any(Array), { order: 'date desc,id desc' });
    expect(result.items[0]).toMatchObject({
      number: 'SL/FY26-27/779',
      salesOrders: ['S01918'],
      salesperson: 'ANAM BANO',
      sales: 94095,
      cogs: 86100,
      grossMargin: 7995,
      transport: 1000,
      loading: 500,
      adjustedGrossMargin: 6495,
    });
    expect(result.totals.adjustedGrossMargin).toBe(6495);
  });
});
