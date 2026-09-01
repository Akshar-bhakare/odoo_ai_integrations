import 'server-only';
import { PNL_ACCOUNT_TYPES } from './pnl';
import { fetchSalesOrderAttribution } from './sales-order-attribution';
import type { OdooGateway } from '@/lib/incentives/odoo/gateway';

type Many2one = false | [number, string];

interface JournalItemRecord {
  id: number;
  move_id: Many2one;
  date: string;
  move_name: string;
  account_id: Many2one;
  partner_id: Many2one;
  debit: number;
  credit: number;
  sale_line_ids: number[];
}

interface AccountMoveRecord {
  id: number;
  move_type: 'out_invoice' | 'out_refund';
  invoice_user_id: Many2one;
}

export interface IncentiveActualItem {
  moveId: number;
  type: 'Invoice' | 'Credit Note';
  date: string;
  number: string;
  salesOrders: string[];
  salesperson: string;
  customer: string;
  sales: number;
  cogs: number;
  grossMargin: number;
  transport: number;
  loading: number;
  adjustedGrossMargin: number;
  marginPercent: number;
}

export interface IncentiveActualPage {
  items: IncentiveActualItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  salespeople: string[];
  totals: {
    sales: number;
    cogs: number;
    grossMargin: number;
    transport: number;
    loading: number;
    adjustedGrossMargin: number;
    marginPercent: number;
  };
}

function relationId(value: Many2one): number | null {
  return value === false ? null : value[0];
}

function relationName(value: Many2one): string {
  return value === false ? '' : value[1];
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function unique(values: number[]): number[] {
  return [...new Set(values)];
}

export async function fetchIncentiveActuals(params: {
  gateway: OdooGateway;
  companyId: number;
  dateFrom: string;
  dateTo: string;
  salesperson?: string;
  page: number;
  pageSize?: number;
}): Promise<IncentiveActualPage> {
  const pageSize = params.pageSize ?? 80;
  const lines = await params.gateway.searchReadAll<JournalItemRecord>(
    'account.move.line',
    [
      ['company_id', '=', params.companyId],
      ['parent_state', '=', 'posted'],
      ['date', '>=', params.dateFrom],
      ['date', '<=', params.dateTo],
      ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
      ['account_id.account_type', 'in', PNL_ACCOUNT_TYPES],
    ],
    [
      'id', 'move_id', 'date', 'move_name', 'account_id', 'partner_id',
      'debit', 'credit', 'sale_line_ids',
    ],
    { order: 'date desc,id desc' },
  );

  const moveIds = unique(lines.flatMap((line) => {
    const id = relationId(line.move_id);
    return id === null ? [] : [id];
  }));
  const moves = moveIds.length === 0 ? [] : await params.gateway.searchReadAll<AccountMoveRecord>(
    'account.move',
    [['id', 'in', moveIds]],
    ['id', 'move_type', 'invoice_user_id'],
  );
  const moveById = new Map(moves.map((move) => [move.id, move]));

  const linesByMoveId = new Map<number, JournalItemRecord[]>();
  for (const line of lines) {
    const moveId = relationId(line.move_id);
    if (moveId !== null) linesByMoveId.set(moveId, [...(linesByMoveId.get(moveId) ?? []), line]);
  }
  const salesOrderAttribution = await fetchSalesOrderAttribution(
    params.gateway,
    [...linesByMoveId.entries()].map(([moveId, moveLines]) => ({
      moveId,
      saleLineIds: unique(moveLines.flatMap((line) => line.sale_line_ids ?? [])),
    })),
  );

  const allItems = [...linesByMoveId.entries()].flatMap(([moveId, moveLines]) => {
    const move = moveById.get(moveId);
    if (!move) return [];
    const attribution = salesOrderAttribution.get(moveId);
    const salesperson = attribution?.salespersonName || relationName(move.invoice_user_id);
    const isRefund = move.move_type === 'out_refund';
    const accountName = (line: JournalItemRecord) => relationName(line.account_id).toLowerCase();
    const salesLines = moveLines.filter((line) => accountName(line).includes('sales income'));
    const cogsLines = moveLines.filter((line) => accountName(line).includes('cost of goods sold'));
    const sales = roundMoney(salesLines.length > 0
      ? salesLines.reduce((sum, line) => sum + line.credit - line.debit, 0)
      : moveLines.reduce((sum, line) => sum + (isRefund ? -line.debit : line.credit), 0));
    const cogs = roundMoney(cogsLines.length > 0
      ? cogsLines.reduce((sum, line) => sum + line.debit - line.credit, 0)
      : moveLines.reduce((sum, line) => sum + (isRefund ? -line.credit : line.debit), 0));
    const chargeDirection = isRefund ? -1 : 1;
    const transport = roundMoney((attribution?.transport ?? 0) * chargeDirection);
    const loading = roundMoney((attribution?.loading ?? 0) * chargeDirection);
    const grossMargin = roundMoney(sales - cogs);
    const adjustedGrossMargin = roundMoney(grossMargin - transport - loading);
    const firstLine = moveLines[0];
    return [{
      moveId,
      type: isRefund ? 'Credit Note' as const : 'Invoice' as const,
      date: firstLine.date,
      number: firstLine.move_name,
      salesOrders: attribution?.salesOrderNames ?? [],
      salesperson,
      customer: moveLines.map((line) => relationName(line.partner_id)).find(Boolean) ?? '',
      sales,
      cogs,
      grossMargin,
      transport,
      loading,
      adjustedGrossMargin,
      marginPercent: sales === 0 ? 0 : roundMoney((adjustedGrossMargin / sales) * 100),
    }];
  }).sort((left, right) => right.date.localeCompare(left.date) || right.moveId - left.moveId);

  const salespeople = [...new Set(allItems.map((item) => item.salesperson).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const selected = params.salesperson?.trim();
  const filtered = selected
    ? allItems.filter((item) => item.salesperson.toLocaleLowerCase() === selected.toLocaleLowerCase())
    : allItems;
  const totals = filtered.reduce((sum, item) => ({
    sales: sum.sales + item.sales,
    cogs: sum.cogs + item.cogs,
    grossMargin: sum.grossMargin + item.grossMargin,
    transport: sum.transport + item.transport,
    loading: sum.loading + item.loading,
    adjustedGrossMargin: sum.adjustedGrossMargin + item.adjustedGrossMargin,
    marginPercent: 0,
  }), { sales: 0, cogs: 0, grossMargin: 0, transport: 0, loading: 0, adjustedGrossMargin: 0, marginPercent: 0 });
  totals.marginPercent = totals.sales === 0 ? 0 : roundMoney((totals.adjustedGrossMargin / totals.sales) * 100);
  for (const key of ['sales', 'cogs', 'grossMargin', 'transport', 'loading', 'adjustedGrossMargin'] as const) {
    totals[key] = roundMoney(totals[key]);
  }
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(params.page, pageCount);

  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
    pageCount,
    salespeople,
    totals,
  };
}
