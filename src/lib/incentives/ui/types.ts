import type {
  IncentiveEngineInput,
  IncentivePresetV1,
  MonthlyIncentiveResult,
} from '../types';
import type { IncentiveRole } from '../odoo/authorization';

export type Many2one = false | [number, string];

export interface SessionActor {
  name: string;
  login: string;
  currentCompanyId: number;
  employeeId: number | null;
  employeeMapping: 'mapped' | 'missing' | 'ambiguous';
  roles: IncentiveRole[];
}

export interface SessionResponse {
  authenticated: true;
  csrfToken: string;
  actor: SessionActor;
}

export interface EmployeeRecord {
  id: number;
  name: string;
  company_id: Many2one;
  user_id: Many2one;
  active: boolean;
}

export interface PresetRecord {
  id: number;
  x_name: string;
  x_code: string;
  x_company_id: Many2one;
  x_current_version_id: Many2one;
  x_active: boolean;
}

export interface PresetVersionRecord {
  id: number;
  x_name: string;
  x_preset_id: Many2one;
  x_company_id: Many2one;
  x_version_number: number;
  x_status: 'draft' | 'active' | 'retired';
  x_rules_checksum: string;
  x_locked: boolean;
  x_activated_by_id: Many2one;
  x_activated_at: string | false;
  create_uid: Many2one;
  create_date: string;
}

export interface PresetVersionDetail extends PresetVersionRecord {
  x_rules_json: string;
  rules: IncentivePresetV1;
}

export interface AssignmentRecord {
  id: number;
  x_name: string;
  x_employee_id: Many2one;
  x_preset_version_id: Many2one;
  x_company_id: Many2one;
  x_date_from: string;
  x_date_to: string | false;
  x_active: boolean;
}

export interface CalculationSummaryRecord {
  id: number;
  x_name: string;
  x_employee_id: Many2one;
  x_month: string;
  x_revision: number;
  x_state: string;
  x_preset_version_id: Many2one;
  x_salary_used: number;
  x_actual_base: number;
  x_raw_incentive: number;
  x_adjustment_total: number;
  x_final_incentive: number;
  x_result_snapshot_json: string;
  x_payment_state: string;
  x_paid_amount: number;
  x_approved_at: string | false;
}

export interface AdjustmentRecord {
  id: number;
  x_operation: 'add' | 'deduct';
  x_amount: number;
  x_reason: string;
  x_notes: string | false;
  create_uid: Many2one;
  create_date: string;
}

export interface PaymentRecord {
  id: number;
  x_amount: number;
  x_payment_date: string;
  x_reference: string;
  x_status: 'recorded' | 'reversed';
  x_recorded_by_id: Many2one;
  x_recorded_at: string;
  x_notes: string | false;
}

export interface CalculationDetailRecord extends CalculationSummaryRecord {
  x_company_id: Many2one;
  x_currency_id: Many2one;
  x_period_start: string;
  x_period_end: string;
  x_supersedes_id: Many2one;
  x_engine_version: string;
  x_rules_checksum: string;
  x_input_checksum: string;
  x_reviewed_by_id: Many2one;
  x_reviewed_at: string | false;
  x_approved_by_id: Many2one;
  x_approved_at: string | false;
  rules: IncentivePresetV1;
  input: IncentiveEngineInput;
  result: MonthlyIncentiveResult;
  customers: Array<{ id: number; name: string }>;
  adjustments: AdjustmentRecord[];
  payments: PaymentRecord[];
}

export interface UnresolvedRecord {
  type: string;
  sourceModel: string;
  sourceId: number | string;
  message: string;
  moveId?: number | null;
  date?: string | null;
  amount?: number | null;
  description?: string | null;
  account?: string | null;
  eventKey?: string | null;
  customer?: string;
  eventDate?: string | null;
  billing?: number | null;
  grossMargin?: number | null;
  kind?: string | null;
  qualification?: string;
}
