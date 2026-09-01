import { monthOf, nextMonth } from '../dates';
import { roundMoney } from '../money';
import type {
  NormalizedAccountingMonth,
  NormalizedCustomerEvent,
  NormalizedMonth,
  OwnershipResolution,
} from '../types';
import type {
  AccountSource,
  AccountingLineSource,
  AccountingMoveSource,
  AccountingSourceAudit,
  IncentiveSourceBundle,
  NormalizedOdooIncentiveData,
  PartnerOwnerChangeSource,
  UnresolvedIncentiveSource,
} from './contracts';

const COMMISSION_ACCOUNT_CODE = '211810';
const EXPENSE_ACCOUNT_TYPES = new Set(['expense', 'expense_direct_cost']);

function emptyAccountingMonth(): NormalizedAccountingMonth {
  return {
    netSales: 0,
    cogs: 0,
    transport: 0,
    loading: 0,
    signedAccountingAdjustments: 0,
    employeeExpenses: 0,
    commission: 0,
  };
}

function calendarMonths(periodStart: string, periodEnd: string): string[] {
  const firstMonth = monthOf(periodStart);
  const lastMonth = monthOf(periodEnd);
  const months = [firstMonth];
  while (months[months.length - 1] !== lastMonth) {
    const following = nextMonth(months[months.length - 1]);
    if (following > lastMonth) {
      throw new Error('Incentive period end must not precede period start');
    }
    months.push(following);
  }
  return months;
}

function isWithinPeriod(date: string, periodStart: string, periodEnd: string): boolean {
  return date >= periodStart && date <= periodEnd;
}

function ownerAtStartOfDay(
  partnerId: number,
  eventDate: string,
  currentOwnerUserId: number | null,
  changes: PartnerOwnerChangeSource[],
): { userId: number | null; source: 'current_partner' | 'tracking_history' } {
  let userId = currentOwnerUserId;
  let source: 'current_partner' | 'tracking_history' = 'current_partner';
  const descendingChanges = changes
    .filter((change) => change.partnerId === partnerId)
    .sort((left, right) => right.changedAt.localeCompare(left.changedAt) || right.id - left.id);

  for (const change of descendingChanges) {
    if (change.localChangeDate >= eventDate) {
      userId = change.oldOwnerUserId;
      source = 'tracking_history';
    }
  }
  return { userId, source };
}

function eventOwnership(params: {
  eventKey: string;
  partnerId: number;
  eventDate: string;
  currentOwnerUserId: number | null;
  ownerChanges: PartnerOwnerChangeSource[];
  employeeByUserId: Map<number, number>;
  manualResolutionByEventKey: Map<string, number>;
  invoiceUserId: number | null;
}): OwnershipResolution {
  const invoiceEmployeeId = params.invoiceUserId === null
    ? undefined
    : params.employeeByUserId.get(params.invoiceUserId);
  if (invoiceEmployeeId !== undefined) {
    return {
      status: 'resolved',
      employeeId: invoiceEmployeeId,
      source: 'sales_order_salesperson',
    };
  }
  const manualEmployeeId = params.manualResolutionByEventKey.get(params.eventKey);
  if (manualEmployeeId !== undefined) {
    return {
      status: 'resolved',
      employeeId: manualEmployeeId,
      source: 'manual_resolution',
    };
  }

  const historicalOwner = ownerAtStartOfDay(
    params.partnerId,
    params.eventDate,
    params.currentOwnerUserId,
    params.ownerChanges,
  );
  const employeeId = historicalOwner.userId === null
    ? undefined
    : params.employeeByUserId.get(historicalOwner.userId);
  if (employeeId === undefined) {
    return {
      status: 'pending',
      employeeId: null,
      source: 'unresolved',
    };
  }
  return {
    status: 'resolved',
    employeeId,
    source: historicalOwner.source,
  };
}

interface MoveAccountingEffect {
  netSales: number;
  cogs: number;
  transport: number;
  loading: number;
  grossMargin: number;
}

function moveAccountingEffect(
  move: AccountingMoveSource,
  lines: AccountingLineSource[],
  accountById: Map<number, AccountSource>,
): MoveAccountingEffect {
  let netSales = 0;
  let cogs = 0;
  for (const line of lines) {
    const account = accountById.get(line.accountId);
    if (account?.accountType === 'income') {
      netSales += -line.balance;
    }
    if (account?.accountType === 'expense_direct_cost') {
      cogs += line.balance;
    }
  }
  const moveDirection = move.moveType === 'out_refund' ? -1 : 1;
  const transport = roundMoney(move.transportCharges * moveDirection);
  const loading = roundMoney(move.loadingCharges * moveDirection);
  return {
    netSales: roundMoney(netSales),
    cogs: roundMoney(cogs),
    transport,
    loading,
    grossMargin: roundMoney(netSales - cogs - transport - loading),
  };
}

function buildCustomerEvents(params: {
  moves: AccountingMoveSource[];
  linesByMoveId: Map<number, AccountingLineSource[]>;
  accountById: Map<number, AccountSource>;
  employeeByUserId: Map<number, number>;
  bundle: IncentiveSourceBundle;
  unresolved: UnresolvedIncentiveSource[];
}): NormalizedCustomerEvent[] {
  const customerMoves = params.moves
    .filter((move) => move.state === 'posted'
      && (move.moveType === 'out_invoice' || move.moveType === 'out_refund')
      && move.commercialPartnerId !== null)
    .sort((left, right) => left.date.localeCompare(right.date) || left.id - right.id);
  const movesByPartner = new Map<number, AccountingMoveSource[]>();
  for (const move of customerMoves) {
    const partnerMoves = movesByPartner.get(move.commercialPartnerId!) ?? [];
    partnerMoves.push(move);
    movesByPartner.set(move.commercialPartnerId!, partnerMoves);
  }
  const currentOwnerByPartner = new Map(
    params.bundle.partnerOwners.map((owner) => [owner.partnerId, owner.currentOwnerUserId]),
  );
  const manualResolutionByEventKey = new Map(
    params.bundle.customerOwnerResolutions
      .filter((resolution) => resolution.status !== 'void')
      .map((resolution) => [resolution.eventKey, resolution.employeeId]),
  );
  const events: NormalizedCustomerEvent[] = [];

  for (const [partnerId, partnerMoves] of movesByPartner) {
    const invoices = partnerMoves.filter((move) => move.moveType === 'out_invoice');
    const firstInvoice = invoices[0];
    if (!firstInvoice) {
      continue;
    }
    const firstMonth = monthOf(firstInvoice.date);
    const firstMonthMoves = partnerMoves.filter((move) => monthOf(move.date) === firstMonth);
    const firstMonthEffect = firstMonthMoves.reduce(
      (total, move) => {
        const effect = moveAccountingEffect(
          move,
          params.linesByMoveId.get(move.id) ?? [],
          params.accountById,
        );
        return {
          billing: roundMoney(total.billing + effect.netSales),
          grossMargin: roundMoney(total.grossMargin + effect.grossMargin),
        };
      },
      { billing: 0, grossMargin: 0 },
    );
    const newEventKey = `new:${partnerId}:${firstInvoice.id}`;
    const newOwnership = eventOwnership({
      eventKey: newEventKey,
      partnerId,
      eventDate: firstInvoice.date,
      currentOwnerUserId: currentOwnerByPartner.get(partnerId) ?? null,
      ownerChanges: params.bundle.partnerOwnerChanges,
      employeeByUserId: params.employeeByUserId,
      manualResolutionByEventKey,
      invoiceUserId: firstInvoice.invoiceUserId,
    });
    if (newOwnership.status === 'pending') {
      params.unresolved.push({
        type: 'customer_owner',
        sourceModel: 'res.partner',
        sourceId: partnerId,
        message: `New-customer event ${newEventKey} has no resolvable sales-order salesperson or fallback owner`,
        eventKey: newEventKey,
        eventDate: firstInvoice.date,
      });
    }
    events.push({
      kind: 'new_customer',
      id: newEventKey,
      customerId: partnerId,
      invoiceNumbers: firstMonthMoves
        .filter((move) => move.moveType === 'out_invoice')
        .map((move) => move.name),
      eventDate: firstInvoice.date,
      billing: firstMonthEffect.billing,
      grossMargin: firstMonthEffect.grossMargin,
      billingEmployeeId: firstInvoice.invoiceUserId === null
        ? null
        : params.employeeByUserId.get(firstInvoice.invoiceUserId) ?? null,
      ownership: newOwnership,
    });

    for (const repeatMove of invoices.slice(1)) {
      if (repeatMove.date <= firstInvoice.date) {
        continue;
      }
      const repeatEventKey = `repeat:${partnerId}:${repeatMove.id}`;
      const effect = moveAccountingEffect(
        repeatMove,
        params.linesByMoveId.get(repeatMove.id) ?? [],
        params.accountById,
      );
      const ownership = eventOwnership({
        eventKey: repeatEventKey,
        partnerId,
        eventDate: repeatMove.date,
        currentOwnerUserId: currentOwnerByPartner.get(partnerId) ?? null,
        ownerChanges: params.bundle.partnerOwnerChanges,
        employeeByUserId: params.employeeByUserId,
        manualResolutionByEventKey,
        invoiceUserId: repeatMove.invoiceUserId,
      });
      if (ownership.status === 'pending') {
        params.unresolved.push({
          type: 'customer_owner',
          sourceModel: 'res.partner',
          sourceId: partnerId,
          message: `Repeat event ${repeatEventKey} has no resolvable sales-order salesperson or fallback owner`,
          eventKey: repeatEventKey,
          eventDate: repeatMove.date,
        });
      }
      events.push({
        kind: 'repeat_customer',
        id: repeatEventKey,
        customerId: partnerId,
        newCustomerEventId: newEventKey,
        invoiceNumbers: [repeatMove.name],
        eventDate: repeatMove.date,
        billing: effect.netSales,
        grossMargin: effect.grossMargin,
        billingEmployeeId: repeatMove.invoiceUserId === null
          ? null
          : params.employeeByUserId.get(repeatMove.invoiceUserId) ?? null,
        ownership,
      });
    }
  }
  return events;
}

export function normalizeOdooIncentiveData(
  bundle: IncentiveSourceBundle,
): NormalizedOdooIncentiveData {
  const months = calendarMonths(bundle.periodStart, bundle.periodEnd);
  const employees = bundle.employees.filter(
    (employee) => employee.companyId === bundle.companyId && employee.active,
  );
  const employeeByUserId = new Map<number, number>();
  for (const employee of employees) {
    if (employee.userId !== null) {
      employeeByUserId.set(employee.userId, employee.id);
    }
  }
  const monthDataByEmployee = new Map<number, Map<string, NormalizedAccountingMonth>>();
  for (const employee of employees) {
    monthDataByEmployee.set(
      employee.id,
      new Map(months.map((month) => [month, emptyAccountingMonth()])),
    );
  }

  const moveById = new Map(bundle.moves.map((move) => [move.id, move]));
  const accountById = new Map(bundle.accounts.map((account) => [account.id, account]));
  const linesByMoveId = new Map<number, AccountingLineSource[]>();
  for (const line of bundle.lines) {
    const moveLines = linesByMoveId.get(line.moveId) ?? [];
    moveLines.push(line);
    linesByMoveId.set(line.moveId, moveLines);
  }
  const unresolved: UnresolvedIncentiveSource[] = [];
  const sourceAudit: AccountingSourceAudit[] = [];

  const addAmount = (
    employeeId: number,
    month: string,
    field: keyof Pick<NormalizedAccountingMonth, 'netSales' | 'cogs' | 'transport' | 'loading' | 'employeeExpenses' | 'commission'>,
    amount: number,
  ) => {
    const employeeMonths = monthDataByEmployee.get(employeeId);
    const accountingMonth = employeeMonths?.get(month);
    if (!accountingMonth) {
      return;
    }
    accountingMonth[field] = roundMoney(accountingMonth[field] + amount);
  };

  const customerMoves = bundle.moves.filter((move) => move.state === 'posted'
    && (move.moveType === 'out_invoice' || move.moveType === 'out_refund')
    && isWithinPeriod(move.date, bundle.periodStart, bundle.periodEnd));
  for (const move of customerMoves) {
    const employeeId = move.invoiceUserId === null
      ? undefined
      : employeeByUserId.get(move.invoiceUserId);
    if (employeeId === undefined) {
      unresolved.push({
        type: 'salesperson_employee',
        sourceModel: 'account.move',
        sourceId: move.id,
        sourceUserId: move.invoiceUserId,
        message: move.invoiceUserId === null
          ? `${move.name} has no invoice salesperson`
          : `${move.name} has no invoice salesperson employee mapping`,
      });
      continue;
    }
    const month = monthOf(move.date);
    const effect = moveAccountingEffect(move, linesByMoveId.get(move.id) ?? [], accountById);
    addAmount(employeeId, month, 'netSales', effect.netSales);
    addAmount(employeeId, month, 'cogs', effect.cogs);
    addAmount(employeeId, month, 'transport', effect.transport);
    addAmount(employeeId, month, 'loading', effect.loading);
    for (const [category, amount] of [
      ['sales', effect.netSales],
      ['cogs', effect.cogs],
      ['transport', effect.transport],
      ['loading', effect.loading],
    ] as const) {
      if (amount !== 0) {
        sourceAudit.push({
          sourceModel: 'account.move',
          sourceId: move.id,
          moveId: move.id,
          employeeId,
          month,
          category,
          signedAmount: amount,
          salesOrderIds: move.salesOrderIds,
          salesOrderNames: move.salesOrderNames,
        });
      }
    }
  }

  const expenseById = new Map(bundle.expenses.map((expense) => [expense.id, expense]));
  const activeExpenseAssignmentsByMove = new Map<number, typeof bundle.expenseAssignments>();
  for (const assignment of bundle.expenseAssignments.filter((item) => item.status !== 'void')) {
    const moveAssignments = activeExpenseAssignmentsByMove.get(assignment.moveId) ?? [];
    moveAssignments.push(assignment);
    activeExpenseAssignmentsByMove.set(assignment.moveId, moveAssignments);
  }
  for (const line of bundle.lines) {
    const move = moveById.get(line.moveId);
    const account = accountById.get(line.accountId);
    if (!move || line.parentState !== 'posted' || !isWithinPeriod(line.date, bundle.periodStart, bundle.periodEnd)
      || !account || !EXPENSE_ACCOUNT_TYPES.has(account.accountType)
      || account.code === COMMISSION_ACCOUNT_CODE) {
      continue;
    }
    let employeeId: number | null | undefined;
    if (line.expenseId !== null) {
      employeeId = expenseById.get(line.expenseId)?.employeeId;
    } else {
      const assignments = activeExpenseAssignmentsByMove.get(move.id) ?? [];
      if (assignments.length > 1) {
        unresolved.push({
          type: 'expense_assignment_conflict',
          sourceModel: 'account.move',
          sourceId: move.id,
          message: `${move.name} has multiple active incentive expense assignments`,
        });
        continue;
      }
      if (assignments.length === 1) {
        employeeId = assignments[0].status === 'unresolved' ? null : assignments[0].employeeId;
      } else {
        continue;
      }
    }
    if (employeeId === null || employeeId === undefined || !monthDataByEmployee.has(employeeId)) {
      unresolved.push({
        type: 'employee_expense',
        sourceModel: line.expenseId === null ? 'account.move' : 'hr.expense',
        sourceId: line.expenseId ?? move.id,
        message: `${move.name} employee expense has no valid single-employee attribution`,
      });
      continue;
    }
    const month = monthOf(line.date);
    addAmount(employeeId, month, 'employeeExpenses', line.balance);
    sourceAudit.push({
      sourceModel: 'account.move.line',
      sourceId: line.id,
      moveId: move.id,
      employeeId,
      month,
      category: 'employee_expense',
      signedAmount: roundMoney(line.balance),
    });
  }

  const activeCommissionAssignments = new Map<number, number>();
  const commissionAssignmentConflicts = new Set<number>();
  for (const assignment of bundle.commissionAssignments.filter((item) => item.status !== 'void')) {
    if (assignment.employeeId === null || activeCommissionAssignments.has(assignment.moveLineId)) {
      commissionAssignmentConflicts.add(assignment.moveLineId);
      continue;
    }
    activeCommissionAssignments.set(assignment.moveLineId, assignment.employeeId);
  }
  for (const line of bundle.lines) {
    const move = moveById.get(line.moveId);
    const account = accountById.get(line.accountId);
    if (!move || line.parentState !== 'posted' || !isWithinPeriod(line.date, bundle.periodStart, bundle.periodEnd)
      || account?.code !== COMMISSION_ACCOUNT_CODE) {
      continue;
    }
    const employeeId = commissionAssignmentConflicts.has(line.id)
      ? undefined
      : activeCommissionAssignments.get(line.id);
    if (employeeId === undefined || !monthDataByEmployee.has(employeeId)) {
      unresolved.push({
        type: 'commission_assignment',
        sourceModel: 'account.move.line',
        sourceId: line.id,
        message: `${move.name} commission line has no valid single-employee attribution`,
      });
      continue;
    }
    const month = monthOf(line.date);
    addAmount(employeeId, month, 'commission', line.balance);
    sourceAudit.push({
      sourceModel: 'account.move.line',
      sourceId: line.id,
      moveId: move.id,
      employeeId,
      month,
      category: 'commission',
      signedAmount: roundMoney(line.balance),
    });
  }

  const customerEvents = buildCustomerEvents({
    moves: bundle.moves,
    linesByMoveId,
    accountById,
    employeeByUserId,
    bundle,
    unresolved,
  });
  const monthsByEmployee: Record<string, NormalizedMonth[]> = {};
  const salaryHistoryByEmployee: NormalizedOdooIncentiveData['salaryHistoryByEmployee'] = {};
  for (const employee of employees) {
    monthsByEmployee[String(employee.id)] = months.map((month) => ({
      month,
      accounting: { ...monthDataByEmployee.get(employee.id)!.get(month)! },
    }));
    salaryHistoryByEmployee[String(employee.id)] = bundle.salaryVersions
      .filter((version) => version.employeeId === employee.id)
      .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
      .map((version) => ({
        id: version.id,
        employeeId: version.employeeId,
        effectiveFrom: version.effectiveFrom,
        monthlyWage: roundMoney(version.monthlyWage),
      }));
  }

  return {
    monthsByEmployee,
    salaryHistoryByEmployee,
    customerEvents,
    unresolvedSources: unresolved,
    sourceAudit,
  };
}
