import 'server-only';
import type { OdooGateway } from '@/lib/incentives/odoo/gateway';

type Many2one = false | [number, string];

interface JournalItemRecord {
  id: number;
  move_id: Many2one;
  date: string;
  move_name: string;
  account_id: Many2one;
  partner_id: Many2one;
  name: string;
  debit: number;
  credit: number;
  balance: number;
  sale_line_ids: number[];
}

interface SaleOrderLineRecord {
  id: number;
  salesman_id: Many2one;
}

interface AccountMoveRecord {
  id: number;
  move_type: string;
  invoice_user_id: Many2one;
}

export interface PnlJournalItem {
  id: number;
  date: string;
  number: string;
  account: string;
  partner: string;
  label: string;
  debit: number;
  credit: number;
  balance: number;
  salespersons: string[];
}

export interface PnlJournalItemPage {
  items: PnlJournalItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export const PNL_ACCOUNT_TYPES = [
  'income',
  'income_other',
  'expense',
  'expense_depreciation',
  'expense_direct_cost',
];

function relationName(value: Many2one): string {
  return value === false ? '' : value[1];
}

export async function fetchPnlJournalItems(params: {
  gateway: OdooGateway;
  companyId: number;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize?: number;
}): Promise<PnlJournalItemPage> {
  const pageSize = params.pageSize ?? 80;
  const domain: unknown[] = [
    ['company_id', '=', params.companyId],
    ['parent_state', '=', 'posted'],
    ['date', '>=', params.dateFrom],
    ['date', '<=', params.dateTo],
    ['account_id.account_type', 'in', PNL_ACCOUNT_TYPES],
  ];
  const total = await params.gateway.searchCount('account.move.line', domain);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(params.page, pageCount);
  const records = await params.gateway.searchRead<JournalItemRecord>(
    'account.move.line',
    domain,
    [
      'id', 'move_id', 'date', 'move_name', 'account_id', 'partner_id', 'name',
      'debit', 'credit', 'balance', 'sale_line_ids',
    ],
    { limit: pageSize, offset: (page - 1) * pageSize, order: 'date desc,id desc' },
  );
  const saleLineIds = [...new Set(records.flatMap((record) => record.sale_line_ids ?? []))];
  const saleLines = saleLineIds.length === 0
    ? []
    : await params.gateway.searchReadAll<SaleOrderLineRecord>(
        'sale.order.line',
        [['id', 'in', saleLineIds]],
        ['id', 'salesman_id'],
      );
  const salespersonByLineId = new Map(
    saleLines.map((line) => [line.id, relationName(line.salesman_id)]),
  );
  const moveIds = [...new Set(records.flatMap((record) => (
    record.move_id === false ? [] : [record.move_id[0]]
  )))];
  const moves = moveIds.length === 0
    ? []
    : await params.gateway.searchReadAll<AccountMoveRecord>(
        'account.move',
        [['id', 'in', moveIds]],
        ['id', 'move_type', 'invoice_user_id'],
      );
  const invoiceSalespersonByMoveId = new Map(
    moves
      .filter((move) => move.move_type === 'out_invoice' || move.move_type === 'out_refund')
      .map((move) => [move.id, relationName(move.invoice_user_id)]),
  );

  return {
    items: records.map((record) => {
      const directSalespersons = [...new Set(
        (record.sale_line_ids ?? [])
          .map((id) => salespersonByLineId.get(id) ?? '')
          .filter(Boolean),
      )];
      const moveId = record.move_id === false ? null : record.move_id[0];
      const invoiceSalesperson = moveId === null
        ? ''
        : invoiceSalespersonByMoveId.get(moveId) ?? '';
      return {
        id: record.id,
        date: record.date,
        number: record.move_name,
        account: relationName(record.account_id),
        partner: relationName(record.partner_id),
        label: record.name,
        debit: record.debit,
        credit: record.credit,
        balance: record.balance,
        salespersons: directSalespersons.length > 0
          ? directSalespersons
          : invoiceSalesperson ? [invoiceSalesperson] : [],
      };
    }),
    total,
    page,
    pageSize,
    pageCount,
  };
}
