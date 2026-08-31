import type {
  NormalizedCustomerEvent,
  NormalizedMonth,
  NormalizedSalaryVersion,
} from '../types';

export type OdooMoveType = 'out_invoice' | 'out_refund' | 'in_invoice' | 'in_refund' | 'entry';
export type OdooAccountType =
  | 'income'
  | 'income_other'
  | 'expense'
  | 'expense_direct_cost'
  | 'asset_current'
  | 'asset_fixed'
  | 'asset_receivable'
  | 'liability_current'
  | 'liability_payable'
  | string;

export interface AccountingMoveSource {
  id: number;
  name: string;
  date: string;
  state: string;
  moveType: OdooMoveType;
  companyId: number;
  commercialPartnerId: number | null;
  invoiceUserId: number | null;
  reversedEntryId: number | null;
  transportCharges: number;
  loadingCharges: number;
  salesOrderIds?: number[];
  salesOrderNames?: string[];
}

export interface AccountingLineSource {
  id: number;
  moveId: number;
  date: string;
  parentState: string;
  accountId: number;
  balance: number;
  debit: number;
  credit: number;
  expenseId: number | null;
}

export interface AccountSource {
  id: number;
  code: string;
  name: string;
  accountType: OdooAccountType;
}

export interface EmployeeSource {
  id: number;
  companyId: number;
  userId: number | null;
  active: boolean;
}

export interface SalaryVersionSource {
  id: number;
  employeeId: number;
  effectiveFrom: string;
  monthlyWage: number;
}

export interface ExpenseSource {
  id: number;
  employeeId: number | null;
  date: string;
  state: string;
}

export interface ExpenseAssignmentSource {
  id: number;
  moveId: number;
  employeeId: number | null;
  status: 'assigned' | 'reassigned' | 'unresolved' | 'void';
}

export interface CommissionAssignmentSource {
  id: number;
  moveLineId: number;
  employeeId: number | null;
  status: 'assigned' | 'reassigned' | 'unresolved' | 'void';
}

export interface PartnerOwnerSource {
  partnerId: number;
  currentOwnerUserId: number | null;
}

export interface PartnerOwnerChangeSource {
  id: number;
  partnerId: number;
  changedAt: string;
  localChangeDate: string;
  oldOwnerUserId: number | null;
  newOwnerUserId: number | null;
}

export interface CustomerOwnerResolutionSource {
  id: number;
  eventKey: string;
  employeeId: number;
  status: 'assigned' | 'reassigned' | 'void';
}

export interface IncentiveSourceBundle {
  companyId: number;
  periodStart: string;
  periodEnd: string;
  moves: AccountingMoveSource[];
  lines: AccountingLineSource[];
  accounts: AccountSource[];
  employees: EmployeeSource[];
  salaryVersions: SalaryVersionSource[];
  expenses: ExpenseSource[];
  expenseAssignments: ExpenseAssignmentSource[];
  commissionAssignments: CommissionAssignmentSource[];
  partnerOwners: PartnerOwnerSource[];
  partnerOwnerChanges: PartnerOwnerChangeSource[];
  customerOwnerResolutions: CustomerOwnerResolutionSource[];
}

export type UnresolvedSourceType =
  | 'salesperson_employee'
  | 'employee_expense'
  | 'expense_assignment_conflict'
  | 'commission_assignment'
  | 'customer_owner';

export interface UnresolvedIncentiveSource {
  type: UnresolvedSourceType;
  sourceModel: string;
  sourceId: number | string;
  message: string;
  sourceUserId?: number | null;
  eventKey?: string;
  eventDate?: string;
}

export interface AccountingSourceAudit {
  sourceModel: 'account.move' | 'account.move.line';
  sourceId: number;
  moveId: number;
  employeeId: number;
  month: string;
  category: 'sales' | 'cogs' | 'transport' | 'loading' | 'employee_expense' | 'commission';
  signedAmount: number;
  salesOrderIds?: number[];
  salesOrderNames?: string[];
}

export interface NormalizedOdooIncentiveData {
  monthsByEmployee: Record<string, NormalizedMonth[]>;
  salaryHistoryByEmployee: Record<string, NormalizedSalaryVersion[]>;
  customerEvents: NormalizedCustomerEvent[];
  unresolvedSources: UnresolvedIncentiveSource[];
  sourceAudit: AccountingSourceAudit[];
}
