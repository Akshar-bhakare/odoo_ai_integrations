import { describe, expect, it, vi } from 'vitest';
import type { OdooGateway } from './gateway';
import { fetchIncentiveSourceBundle } from './extraction';
import { normalizeOdooIncentiveData } from './normalization';

describe('Odoo incentive extraction', () => {
  it('uses P&L journal values and linked sales-order attribution and charges', async () => {
    const gateway = {
      searchCount: vi.fn(),
      searchRead: vi.fn(async () => []),
      searchReadAll: vi.fn(async (model: string, domain: unknown[]) => {
        if (model === 'account.move') return [{
          id: 9290,
          name: 'SL/FY26-27/779',
          date: '2026-08-22',
          state: 'posted',
          move_type: 'out_invoice',
          company_id: [1, 'Sunlectric'],
          commercial_partner_id: [20, 'Adhiraj Urja Solar Soluation'],
          invoice_user_id: false,
          reversed_entry_id: false,
          x_studio_transport_charges: 9999,
          x_studio_loading_charges: 9999,
        }];
        if (model === 'account.move.line') {
          if (JSON.stringify(domain).includes('expense_id')) return [];
          return [{
            id: 1,
            move_id: [9290, 'SL/FY26-27/779'],
            date: '2026-08-22',
            parent_state: 'posted',
            account_id: [10, 'Sales Income'],
            balance: -94095,
            debit: 0,
            credit: 94095,
            expense_id: false,
            sale_line_ids: [30],
          }, {
            id: 2,
            move_id: [9290, 'SL/FY26-27/779'],
            date: '2026-08-22',
            parent_state: 'posted',
            account_id: [11, 'Cost of Goods Sold'],
            balance: 86100,
            debit: 86100,
            credit: 0,
            expense_id: false,
            sale_line_ids: [],
          }];
        }
        if (model === 'sale.order.line') return [{
          id: 30,
          order_id: [1918, 'S01918'],
          salesman_id: [52, 'ANAM BANO'],
        }];
        if (model === 'sale.order') return [{
          id: 1918,
          name: 'S01918',
          user_id: [52, 'ANAM BANO'],
          invoice_ids: [9290],
          x_studio_transport_charges: 1000,
          x_studio_loading_charges: 500,
        }];
        if (model === 'account.account') {
          if (JSON.stringify(domain).includes('211810')) return [];
          return [
            { id: 10, code: '50103000', name: 'Sales Income - Material', account_type: 'income' },
            { id: 11, code: '60101000', name: 'Cost of Goods Sold', account_type: 'expense_direct_cost' },
          ];
        }
        if (model === 'hr.employee') return [{ id: 8, company_id: [1, 'Sunlectric'], user_id: [52, 'ANAM BANO'], active: true }];
        if (model === 'hr.version') return [{ id: 80, employee_id: [8, 'ANAM BANO'], date_version: '2026-08-01', wage: 20000 }];
        if (model === 'res.partner') return [{ id: 20, user_id: [52, 'ANAM BANO'] }];
        return [];
      }),
      create: vi.fn(),
      write: vi.fn(),
      unlink: vi.fn(),
    } as OdooGateway;

    const bundle = await fetchIncentiveSourceBundle({
      gateway,
      companyId: 1,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
    });
    expect(bundle.moves[0]).toMatchObject({
      invoiceUserId: 52,
      transportCharges: 1000,
      loadingCharges: 500,
      salesOrderIds: [1918],
      salesOrderNames: ['S01918'],
    });

    const normalized = normalizeOdooIncentiveData(bundle);
    expect(normalized.monthsByEmployee['8'][0].accounting).toMatchObject({
      netSales: 94095,
      cogs: 86100,
      transport: 1000,
      loading: 500,
    });
  });
});
