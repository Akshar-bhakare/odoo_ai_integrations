import type {
  AccountSource,
  AccountingLineSource,
  AccountingMoveSource,
  CommissionAssignmentSource,
  CustomerOwnerResolutionSource,
  EmployeeSource,
  ExpenseAssignmentSource,
  ExpenseSource,
  IncentiveSourceBundle,
  PartnerOwnerChangeSource,
  PartnerOwnerSource,
  SalaryVersionSource,
} from './contracts';
import { defaultOdooGateway, type OdooGateway } from './gateway';
import { fetchSalesOrderAttribution } from '@/lib/accounting/sales-order-attribution';

type OdooMany2one = false | [number, string];

interface OdooMoveRecord {
  id: number;
  name: string;
  date: string;
  state: string;
  move_type: AccountingMoveSource['moveType'];
  company_id: OdooMany2one;
  commercial_partner_id: OdooMany2one;
  invoice_user_id: OdooMany2one;
  reversed_entry_id: OdooMany2one;
  x_studio_transport_charges: number | false;
  x_studio_loading_charges: number | false;
}

interface OdooLineRecord {
  id: number;
  move_id: OdooMany2one;
  date: string;
  parent_state: string;
  account_id: OdooMany2one;
  balance: number;
  debit: number;
  credit: number;
  expense_id: OdooMany2one;
  sale_line_ids: number[];
}

interface OdooAccountRecord {
  id: number;
  code: string;
  name: string;
  account_type: string;
}

interface OdooEmployeeRecord {
  id: number;
  company_id: OdooMany2one;
  user_id: OdooMany2one;
  active: boolean;
}

interface OdooSalaryVersionRecord {
  id: number;
  employee_id: OdooMany2one;
  date_version: string;
  wage: number;
}

interface OdooExpenseRecord {
  id: number;
  employee_id: OdooMany2one;
  date: string;
  state: string;
}

interface OdooPartnerRecord {
  id: number;
  user_id: OdooMany2one;
}

interface OdooModelFieldRecord {
  id: number;
}

interface OdooTrackingRecord {
  id: number;
  mail_message_id: OdooMany2one;
  old_value_integer: number;
  new_value_integer: number;
  create_date: string;
}

interface OdooMessageRecord {
  id: number;
  model: string;
  res_id: number;
  date: string;
}

export interface IncentiveAttributionReader {
  getExpenseAssignments(): Promise<ExpenseAssignmentSource[]>;
  getCommissionAssignments(): Promise<CommissionAssignmentSource[]>;
  getCustomerOwnerResolutions(): Promise<CustomerOwnerResolutionSource[]>;
}

const emptyAttributionReader: IncentiveAttributionReader = {
  async getExpenseAssignments() {
    return [];
  },
  async getCommissionAssignments() {
    return [];
  },
  async getCustomerOwnerResolutions() {
    return [];
  },
};

function many2oneId(value: OdooMany2one): number | null {
  return value === false ? null : value[0];
}

function uniqueNumbers(values: Array<number | null>): number[] {
  return [...new Set(values.filter((value): value is number => value !== null))];
}

function localDate(odooUtcDateTime: string, timeZone: string): string {
  const utcDate = new Date(`${odooUtcDateTime.replace(' ', 'T')}Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(utcDate);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function fetchLinesByMoveIds(
  gateway: OdooGateway,
  moveIds: number[],
): Promise<OdooLineRecord[]> {
  if (moveIds.length === 0) {
    return [];
  }
  return gateway.searchReadAll<OdooLineRecord>(
    'account.move.line',
    [['move_id', 'in', moveIds], ['parent_state', '=', 'posted']],
    [
      'id', 'move_id', 'date', 'parent_state', 'account_id', 'balance', 'debit',
      'credit', 'expense_id', 'sale_line_ids',
    ],
    { order: 'date,id' },
  );
}

export async function fetchIncentiveSourceBundle(params: {
  companyId: number;
  periodStart: string;
  periodEnd: string;
  timeZone?: string;
  gateway?: OdooGateway;
  attributionReader?: IncentiveAttributionReader;
}): Promise<IncentiveSourceBundle> {
  const gateway = params.gateway ?? defaultOdooGateway;
  const attributionReader = params.attributionReader ?? emptyAttributionReader;
  const timeZone = params.timeZone ?? 'Asia/Calcutta';
  const expenseAssignments = await attributionReader.getExpenseAssignments();
  const commissionAssignments = await attributionReader.getCommissionAssignments();
  const customerOwnerResolutions = await attributionReader.getCustomerOwnerResolutions();

  const customerMoves = await gateway.searchReadAll<OdooMoveRecord>(
    'account.move',
    [
      ['company_id', '=', params.companyId],
      ['state', '=', 'posted'],
      ['move_type', 'in', ['out_invoice', 'out_refund']],
      ['date', '<=', params.periodEnd],
    ],
    [
      'id', 'name', 'date', 'state', 'move_type', 'company_id', 'commercial_partner_id',
      'invoice_user_id', 'reversed_entry_id', 'x_studio_transport_charges',
      'x_studio_loading_charges',
    ],
    { order: 'date,id' },
  );
  const expenseLines = await gateway.searchReadAll<OdooLineRecord>(
    'account.move.line',
    [
      ['company_id', '=', params.companyId],
      ['parent_state', '=', 'posted'],
      ['date', '>=', params.periodStart],
      ['date', '<=', params.periodEnd],
      ['expense_id', '!=', false],
    ],
    [
      'id', 'move_id', 'date', 'parent_state', 'account_id', 'balance', 'debit',
      'credit', 'expense_id', 'sale_line_ids',
    ],
    { order: 'date,id' },
  );
  const commissionAccounts = await gateway.searchReadAll<OdooAccountRecord>(
    'account.account',
    [['company_ids', 'in', [params.companyId]], ['code', '=', '211810']],
    ['id', 'code', 'name', 'account_type'],
  );
  const commissionLines = commissionAccounts.length === 0
    ? []
    : await gateway.searchReadAll<OdooLineRecord>(
        'account.move.line',
        [
          ['company_id', '=', params.companyId],
          ['parent_state', '=', 'posted'],
          ['date', '>=', params.periodStart],
          ['date', '<=', params.periodEnd],
          ['account_id', 'in', commissionAccounts.map((account) => account.id)],
        ],
        [
          'id', 'move_id', 'date', 'parent_state', 'account_id', 'balance', 'debit',
          'credit', 'expense_id', 'sale_line_ids',
        ],
        { order: 'date,id' },
      );
  const manualExpenseMoveIds = uniqueNumbers(expenseAssignments.map((assignment) => assignment.moveId));
  const customerMoveIds = customerMoves.map((move) => move.id);
  const customerLines = await fetchLinesByMoveIds(gateway, customerMoveIds);
  const saleLineIdsByMoveId = new Map<number, number[]>();
  for (const line of customerLines) {
    const moveId = many2oneId(line.move_id);
    if (moveId !== null) {
      saleLineIdsByMoveId.set(moveId, [
        ...(saleLineIdsByMoveId.get(moveId) ?? []),
        ...(line.sale_line_ids ?? []),
      ]);
    }
  }
  const saleOrderAttribution = await fetchSalesOrderAttribution(
    gateway,
    customerMoveIds.map((moveId) => ({
      moveId,
      saleLineIds: uniqueNumbers(saleLineIdsByMoveId.get(moveId) ?? []),
    })),
  );
  const manualExpenseLines = await fetchLinesByMoveIds(gateway, manualExpenseMoveIds);
  const allLineRecords = new Map<number, OdooLineRecord>();
  for (const line of [...customerLines, ...expenseLines, ...commissionLines, ...manualExpenseLines]) {
    allLineRecords.set(line.id, line);
  }

  const additionalMoveIds = uniqueNumbers(
    [...expenseLines, ...commissionLines, ...manualExpenseLines].map((line) => many2oneId(line.move_id)),
  ).filter((moveId) => !customerMoveIds.includes(moveId));
  const additionalMoves = additionalMoveIds.length === 0
    ? []
    : await gateway.searchReadAll<OdooMoveRecord>(
        'account.move',
        [['id', 'in', additionalMoveIds], ['state', '=', 'posted']],
        [
          'id', 'name', 'date', 'state', 'move_type', 'company_id', 'commercial_partner_id',
          'invoice_user_id', 'reversed_entry_id', 'x_studio_transport_charges',
          'x_studio_loading_charges',
        ],
      );
  const moveRecords = [...customerMoves, ...additionalMoves];
  const lineRecords = [...allLineRecords.values()];
  const accountIds = uniqueNumbers([
    ...lineRecords.map((line) => many2oneId(line.account_id)),
    ...commissionAccounts.map((account) => account.id),
  ]);
  const accountRecords = accountIds.length === 0
    ? []
    : await gateway.searchReadAll<OdooAccountRecord>(
        'account.account',
        [['id', 'in', accountIds]],
        ['id', 'code', 'name', 'account_type'],
      );
  const employees = await gateway.searchReadAll<OdooEmployeeRecord>(
    'hr.employee',
    [['company_id', '=', params.companyId]],
    ['id', 'company_id', 'user_id', 'active'],
    { context: { active_test: false }, order: 'id' },
  );
  const salaryVersions = await gateway.searchReadAll<OdooSalaryVersionRecord>(
    'hr.version',
    [['company_id', '=', params.companyId]],
    ['id', 'employee_id', 'date_version', 'wage'],
    { order: 'employee_id,date_version,id' },
  );
  const expenseIds = uniqueNumbers(expenseLines.map((line) => many2oneId(line.expense_id)));
  const expenses = expenseIds.length === 0
    ? []
    : await gateway.searchReadAll<OdooExpenseRecord>(
        'hr.expense',
        [['id', 'in', expenseIds]],
        ['id', 'employee_id', 'date', 'state'],
      );
  const commercialPartnerIds = uniqueNumbers(customerMoves.map((move) => many2oneId(move.commercial_partner_id)));
  const partners = commercialPartnerIds.length === 0
    ? []
    : await gateway.searchReadAll<OdooPartnerRecord>(
        'res.partner',
        [['id', 'in', commercialPartnerIds]],
        ['id', 'user_id'],
      );

  let partnerOwnerChanges: PartnerOwnerChangeSource[] = [];
  const ownerFields = await gateway.searchRead<OdooModelFieldRecord>(
    'ir.model.fields',
    [['model', '=', 'res.partner'], ['name', '=', 'user_id']],
    ['id'],
    { limit: 1 },
  );
  if (ownerFields[0]) {
    const tracking = await gateway.searchReadAll<OdooTrackingRecord>(
      'mail.tracking.value',
      [['field_id', '=', ownerFields[0].id]],
      ['id', 'mail_message_id', 'old_value_integer', 'new_value_integer', 'create_date'],
      { order: 'create_date,id' },
    );
    const messageIds = uniqueNumbers(tracking.map((record) => many2oneId(record.mail_message_id)));
    const messages = messageIds.length === 0
      ? []
      : await gateway.searchReadAll<OdooMessageRecord>(
          'mail.message',
          [['id', 'in', messageIds], ['model', '=', 'res.partner'], ['res_id', 'in', commercialPartnerIds]],
          ['id', 'model', 'res_id', 'date'],
        );
    const messageById = new Map(messages.map((message) => [message.id, message]));
    partnerOwnerChanges = tracking.flatMap((record) => {
      const messageId = many2oneId(record.mail_message_id);
      const message = messageId === null ? undefined : messageById.get(messageId);
      if (!message) {
        return [];
      }
      const changedAt = message.date || record.create_date;
      return [{
        id: record.id,
        partnerId: message.res_id,
        changedAt,
        localChangeDate: localDate(changedAt, timeZone),
        oldOwnerUserId: record.old_value_integer || null,
        newOwnerUserId: record.new_value_integer || null,
      }];
    });
  }

  const moves: AccountingMoveSource[] = moveRecords.map((move) => ({
    id: move.id,
    name: move.name,
    date: move.date,
    state: move.state,
    moveType: move.move_type,
    companyId: many2oneId(move.company_id)!,
    commercialPartnerId: many2oneId(move.commercial_partner_id),
    invoiceUserId: saleOrderAttribution.get(move.id)?.salespersonUserId
      ?? many2oneId(move.invoice_user_id),
    reversedEntryId: many2oneId(move.reversed_entry_id),
    transportCharges: saleOrderAttribution.has(move.id)
      ? Number(saleOrderAttribution.get(move.id)?.transport ?? 0)
      : Number(move.x_studio_transport_charges || 0),
    loadingCharges: saleOrderAttribution.has(move.id)
      ? Number(saleOrderAttribution.get(move.id)?.loading ?? 0)
      : Number(move.x_studio_loading_charges || 0),
    salesOrderIds: saleOrderAttribution.get(move.id)?.salesOrderIds ?? [],
    salesOrderNames: saleOrderAttribution.get(move.id)?.salesOrderNames ?? [],
  }));
  const lines: AccountingLineSource[] = lineRecords.map((line) => ({
    id: line.id,
    moveId: many2oneId(line.move_id)!,
    date: line.date,
    parentState: line.parent_state,
    accountId: many2oneId(line.account_id)!,
    balance: line.balance,
    debit: line.debit,
    credit: line.credit,
    expenseId: many2oneId(line.expense_id),
  }));
  const accounts: AccountSource[] = accountRecords.map((account) => ({
    id: account.id,
    code: account.code,
    name: account.name,
    accountType: account.account_type,
  }));
  const employeeSources: EmployeeSource[] = employees.map((employee) => ({
    id: employee.id,
    companyId: many2oneId(employee.company_id)!,
    userId: many2oneId(employee.user_id),
    active: employee.active,
  }));
  const salarySources: SalaryVersionSource[] = salaryVersions.map((version) => ({
    id: version.id,
    employeeId: many2oneId(version.employee_id)!,
    effectiveFrom: version.date_version,
    monthlyWage: version.wage,
  }));
  const expenseSources: ExpenseSource[] = expenses.map((expense) => ({
    id: expense.id,
    employeeId: many2oneId(expense.employee_id),
    date: expense.date,
    state: expense.state,
  }));
  const partnerOwners: PartnerOwnerSource[] = partners.map((partner) => ({
    partnerId: partner.id,
    currentOwnerUserId: many2oneId(partner.user_id),
  }));

  return {
    companyId: params.companyId,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    moves,
    lines,
    accounts,
    employees: employeeSources,
    salaryVersions: salarySources,
    expenses: expenseSources,
    expenseAssignments,
    commissionAssignments,
    partnerOwners,
    partnerOwnerChanges,
    customerOwnerResolutions,
  };
}
