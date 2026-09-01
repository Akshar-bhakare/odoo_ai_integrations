import { describe, expect, it } from 'vitest';
import { calculateIncentives } from '../engine';
import { makePreset } from '../test-helpers';
import type { IncentiveSourceBundle } from './contracts';
import { normalizeOdooIncentiveData } from './normalization';

function sourceBundle(): IncentiveSourceBundle {
  return {
    companyId: 1,
    periodStart: '2025-12-01',
    periodEnd: '2025-12-31',
    moves: [
      {
        id: 1658,
        name: 'SL/FY25-26/174',
        date: '2025-12-02',
        state: 'posted',
        moveType: 'out_invoice',
        companyId: 1,
        commercialPartnerId: 100,
        invoiceUserId: 10,
        reversedEntryId: null,
        transportCharges: 0,
        loadingCharges: 0,
      },
      {
        id: 1659,
        name: 'RMHD/25-26/0006',
        date: '2025-12-10',
        state: 'posted',
        moveType: 'out_refund',
        companyId: 1,
        commercialPartnerId: 100,
        invoiceUserId: 10,
        reversedEntryId: 1658,
        transportCharges: 0,
        loadingCharges: 0,
      },
    ],
    lines: [
      { id: 1, moveId: 1658, date: '2025-12-02', parentState: 'posted', accountId: 1, balance: -47200, debit: 0, credit: 47200, expenseId: null },
      { id: 2, moveId: 1658, date: '2025-12-02', parentState: 'posted', accountId: 2, balance: 37100, debit: 37100, credit: 0, expenseId: null },
      { id: 3, moveId: 1659, date: '2025-12-10', parentState: 'posted', accountId: 1, balance: 47200, debit: 47200, credit: 0, expenseId: null },
      { id: 4, moveId: 1659, date: '2025-12-10', parentState: 'posted', accountId: 2, balance: -37100, debit: 0, credit: 37100, expenseId: null },
    ],
    accounts: [
      { id: 1, code: '50103000', name: 'Sales Income - Material', accountType: 'income' },
      { id: 2, code: '60101000', name: 'Cost of Goods Sold', accountType: 'expense_direct_cost' },
      { id: 3, code: '70202000', name: 'Fuel Expenses', accountType: 'expense' },
      { id: 4, code: '211810', name: 'Sales Commission Expense', accountType: 'expense' },
    ],
    employees: [
      { id: 1, companyId: 1, userId: 10, active: true },
      { id: 2, companyId: 1, userId: 20, active: true },
    ],
    salaryVersions: [
      { id: 1, employeeId: 1, effectiveFrom: '2025-01-01', monthlyWage: 20000 },
      { id: 2, employeeId: 2, effectiveFrom: '2025-01-01', monthlyWage: 20000 },
    ],
    expenses: [],
    expenseAssignments: [],
    commissionAssignments: [],
    partnerOwners: [{ partnerId: 100, currentOwnerUserId: 10 }],
    partnerOwnerChanges: [],
    customerOwnerResolutions: [],
  };
}

describe('Odoo incentive normalization', () => {
  it('reverses invoice Sales, COGS, and Gross Margin exactly once', () => {
    const normalized = normalizeOdooIncentiveData(sourceBundle());
    const december = normalized.monthsByEmployee['1'][0];
    const refundSales = normalized.sourceAudit.find(
      (source) => source.moveId === 1659 && source.category === 'sales',
    );
    const refundCogs = normalized.sourceAudit.find(
      (source) => source.moveId === 1659 && source.category === 'cogs',
    );

    expect(refundSales?.signedAmount).toBe(-47200);
    expect(refundCogs?.signedAmount).toBe(-37100);
    expect(december.accounting.netSales).toBe(0);
    expect(december.accounting.cogs).toBe(0);
    expect(december.accounting.signedAccountingAdjustments).toBe(0);

    const engineResult = calculateIncentives({
      employeeId: 1,
      companyId: 1,
      months: normalized.monthsByEmployee['1'],
      salaryHistory: normalized.salaryHistoryByEmployee['1'],
      customerEvents: normalized.customerEvents,
      adjustments: [],
      preset: makePreset(),
    });
    expect(engineResult.months[0].accounting.grossMargin).toBe(0);
    expect(engineResult.months[0].accounting.actualBase).toBe(0);
    expect(normalized.customerEvents[0]?.invoiceNumbers).toEqual(['SL/FY25-26/174']);
  });

  it('reduces Sales and Gross Margin for a partial credit note', () => {
    const bundle = sourceBundle();
    bundle.lines.find((line) => line.id === 3)!.balance = 20000;
    bundle.lines.find((line) => line.id === 3)!.debit = 20000;
    bundle.lines.find((line) => line.id === 4)!.balance = -15000;
    bundle.lines.find((line) => line.id === 4)!.credit = 15000;

    const normalized = normalizeOdooIncentiveData(bundle);
    const december = normalized.monthsByEmployee['1'][0].accounting;

    expect(december.netSales).toBe(27200);
    expect(december.cogs).toBe(22100);
    expect(december.netSales - december.cogs).toBe(5100);
  });

  it('deducts posted expense-linked P&L lines from the expense employee only', () => {
    const bundle = sourceBundle();
    bundle.moves.push({
      id: 2000,
      name: 'BILL/EXP/1',
      date: '2025-12-15',
      state: 'posted',
      moveType: 'in_invoice',
      companyId: 1,
      commercialPartnerId: null,
      invoiceUserId: null,
      reversedEntryId: null,
      transportCharges: 0,
      loadingCharges: 0,
    });
    bundle.lines.push({ id: 20, moveId: 2000, date: '2025-12-15', parentState: 'posted', accountId: 3, balance: 5000, debit: 5000, credit: 0, expenseId: 50 });
    bundle.expenses.push({ id: 50, employeeId: 2, date: '2025-12-14', state: 'paid' });

    const normalized = normalizeOdooIncentiveData(bundle);

    expect(normalized.monthsByEmployee['1'][0].accounting.employeeExpenses).toBe(0);
    expect(normalized.monthsByEmployee['2'][0].accounting.employeeExpenses).toBe(5000);
  });

  it('requires exactly one explicit assignment for a manual employee expense', () => {
    const bundle = sourceBundle();
    bundle.moves.push({
      id: 2001,
      name: 'BILL/MANUAL/1',
      date: '2025-12-16',
      state: 'posted',
      moveType: 'in_invoice',
      companyId: 1,
      commercialPartnerId: null,
      invoiceUserId: null,
      reversedEntryId: null,
      transportCharges: 0,
      loadingCharges: 0,
    });
    bundle.lines.push({ id: 21, moveId: 2001, date: '2025-12-16', parentState: 'posted', accountId: 3, balance: 7000, debit: 7000, credit: 0, expenseId: null });
    bundle.expenseAssignments.push(
      { id: 1, moveId: 2001, employeeId: 1, status: 'assigned' },
      { id: 2, moveId: 2001, employeeId: 2, status: 'assigned' },
    );

    const normalized = normalizeOdooIncentiveData(bundle);

    expect(normalized.monthsByEmployee['1'][0].accounting.employeeExpenses).toBe(0);
    expect(normalized.monthsByEmployee['2'][0].accounting.employeeExpenses).toBe(0);
    expect(normalized.unresolvedSources.some((source) => source.type === 'expense_assignment_conflict')).toBe(true);
  });

  it('leaves commission unresolved until one employee assignment exists', () => {
    const bundle = sourceBundle();
    bundle.moves.push({
      id: 3000,
      name: 'BILL/COMMISSION/1',
      date: '2025-12-20',
      state: 'posted',
      moveType: 'in_invoice',
      companyId: 1,
      commercialPartnerId: null,
      invoiceUserId: null,
      reversedEntryId: null,
      transportCharges: 0,
      loadingCharges: 0,
    });
    bundle.lines.push({ id: 30, moveId: 3000, date: '2025-12-20', parentState: 'posted', accountId: 4, balance: 10000, debit: 10000, credit: 0, expenseId: null });

    const unresolved = normalizeOdooIncentiveData(bundle);
    bundle.commissionAssignments.push({ id: 1, moveLineId: 30, employeeId: 1, status: 'assigned' });
    const assigned = normalizeOdooIncentiveData(bundle);

    expect(unresolved.monthsByEmployee['1'][0].accounting.commission).toBe(0);
    expect(unresolved.unresolvedSources.some((source) => source.type === 'commission_assignment')).toBe(true);
    expect(assigned.monthsByEmployee['1'][0].accounting.commission).toBe(10000);
  });

  it('uses the owner effective at the start of a same-day event', () => {
    const bundle = sourceBundle();
    bundle.moves[0].invoiceUserId = null;
    bundle.partnerOwners[0].currentOwnerUserId = 20;
    bundle.partnerOwnerChanges.push({
      id: 1,
      partnerId: 100,
      changedAt: '2025-12-02 06:00:00',
      localChangeDate: '2025-12-02',
      oldOwnerUserId: 10,
      newOwnerUserId: 20,
    });

    const normalized = normalizeOdooIncentiveData(bundle);
    const newEvent = normalized.customerEvents.find((event) => event.kind === 'new_customer');

    expect(newEvent?.ownership).toEqual({
      status: 'resolved',
      employeeId: 1,
      source: 'tracking_history',
    });
  });

  it('retains event identity and date on unresolved customer owners', () => {
    const bundle = sourceBundle();
    bundle.moves[0].invoiceUserId = null;
    bundle.partnerOwners[0].currentOwnerUserId = null;

    const normalized = normalizeOdooIncentiveData(bundle);
    const unresolved = normalized.unresolvedSources.find((source) => source.type === 'customer_owner');

    expect(unresolved).toMatchObject({
      eventKey: 'new:100:1658',
      eventDate: '2025-12-02',
    });
  });

  it('uses the sales-order salesperson for customer bonus ownership', () => {
    const bundle = sourceBundle();
    bundle.partnerOwners[0].currentOwnerUserId = 20;

    const normalized = normalizeOdooIncentiveData(bundle);
    const newEvent = normalized.customerEvents.find((event) => event.kind === 'new_customer');

    expect(newEvent).toMatchObject({
      billingEmployeeId: 1,
      ownership: {
        status: 'resolved',
        employeeId: 1,
        source: 'sales_order_salesperson',
      },
    });
  });
});
