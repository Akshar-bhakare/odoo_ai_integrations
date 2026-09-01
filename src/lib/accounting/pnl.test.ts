import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { OdooGateway } from '@/lib/incentives/odoo/gateway';
import { fetchPnlJournalItems } from './pnl';

describe('P&L journal items', () => {
  it('uses the posted P&L domain and maps the Odoo export columns', async () => {
    const gateway: OdooGateway = {
      searchCount: vi.fn(async () => 2639),
      searchRead: vi.fn(async () => [
        {
          id: 10,
          move_id: [100, 'SL/FY26-27/779'],
          date: '2026-08-22',
          move_name: 'SL/FY26-27/779',
          account_id: [20, '50103000 Sales Income - Material'],
          partner_id: [30, 'Adhiraj Urja Solar Soluation'],
          name: '[SM-10000574] Waaree 615Wp TopCon BF NDCR Solar Module',
          debit: 0,
          credit: 94095,
          balance: -94095,
          sale_line_ids: [40],
        },
        {
          id: 11,
          move_id: [100, 'SL/FY26-27/779'],
          date: '2026-08-22',
          move_name: 'SL/FY26-27/779',
          account_id: [21, '60101000 Cost of Goods Sold'],
          partner_id: [30, 'Adhiraj Urja Solar Soluation'],
          name: '[SM-10000574] Waaree 615Wp TopCon BF NDCR Solar Module',
          debit: 86100,
          credit: 0,
          balance: 86100,
          sale_line_ids: [],
        },
      ]),
      searchReadAll: vi.fn(async (model: string) => model === 'sale.order.line'
        ? [{ id: 40, salesman_id: [50, 'ANAM BANO'] }]
        : [{ id: 100, move_type: 'out_invoice', invoice_user_id: [50, 'ANAM BANO'] }]),
      create: vi.fn(),
      write: vi.fn(),
      unlink: vi.fn(),
    } as OdooGateway;

    const result = await fetchPnlJournalItems({
      gateway,
      companyId: 1,
      dateFrom: '2026-04-01',
      dateTo: '2026-09-30',
      page: 1,
    });

    expect(gateway.searchCount).toHaveBeenCalledWith('account.move.line', [
      ['company_id', '=', 1],
      ['parent_state', '=', 'posted'],
      ['date', '>=', '2026-04-01'],
      ['date', '<=', '2026-09-30'],
      ['account_id.account_type', 'in', ['income', 'income_other', 'expense', 'expense_depreciation', 'expense_direct_cost']],
    ]);
    expect(result).toMatchObject({
      total: 2639,
      page: 1,
      pageSize: 80,
      pageCount: 33,
      items: [{
        number: 'SL/FY26-27/779',
        account: '50103000 Sales Income - Material',
        partner: 'Adhiraj Urja Solar Soluation',
        debit: 0,
        credit: 94095,
        salespersons: ['ANAM BANO'],
      }, {
        number: 'SL/FY26-27/779',
        account: '60101000 Cost of Goods Sold',
        debit: 86100,
        credit: 0,
        salespersons: ['ANAM BANO'],
      }],
    });
  });
});
