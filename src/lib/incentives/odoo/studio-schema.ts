import type { OdooGateway } from './gateway';

export const INCENTIVE_STUDIO_MODELS = {
  preset: 'x_sunlectric_incentive_preset',
  presetVersion: 'x_sunlectric_incentive_preset_version',
  employeeAssignment: 'x_sunlectric_incentive_assignment',
  expenseAssignment: 'x_sunlectric_incentive_expense_assignment',
  commissionAssignment: 'x_sunlectric_incentive_commission_assignment',
  customerOwnerResolution: 'x_sunlectric_incentive_owner_resolution',
  adjustment: 'x_sunlectric_incentive_adjustment',
  calculation: 'x_sunlectric_incentive_calculation',
  calculationSource: 'x_sunlectric_incentive_calculation_source',
  payment: 'x_sunlectric_incentive_payment',
} as const;

export type StudioFieldType =
  | 'boolean'
  | 'char'
  | 'date'
  | 'datetime'
  | 'float'
  | 'integer'
  | 'many2one'
  | 'monetary'
  | 'selection'
  | 'text';

export interface StudioFieldDefinition {
  label: string;
  type: StudioFieldType;
  relation?: string;
  required?: boolean;
  readonly?: boolean;
  index?: boolean;
  copied?: boolean;
  onDelete?: 'cascade' | 'restrict' | 'set null';
  currencyField?: string;
  selection?: ReadonlyArray<readonly [string, string]>;
}

export interface StudioModelDefinition {
  name: string;
  fields: Record<string, StudioFieldDefinition>;
}

const nameField: StudioFieldDefinition = {
  label: 'Name',
  type: 'char',
  required: true,
  index: true,
};

const companyField: StudioFieldDefinition = {
  label: 'Company',
  type: 'many2one',
  relation: 'res.company',
  required: true,
  index: true,
  onDelete: 'restrict',
};

const currencyField: StudioFieldDefinition = {
  label: 'Currency',
  type: 'many2one',
  relation: 'res.currency',
  required: true,
  onDelete: 'restrict',
};

const moneyField = (label: string): StudioFieldDefinition => ({
  label,
  type: 'monetary',
  currencyField: 'x_currency_id',
});

const statusSelection = (
  label: string,
  selection: ReadonlyArray<readonly [string, string]>,
): StudioFieldDefinition => ({
  label,
  type: 'selection',
  selection,
  required: true,
});

export const INCENTIVE_STUDIO_MODEL_DEFINITIONS: Record<string, StudioModelDefinition> = {
  [INCENTIVE_STUDIO_MODELS.preset]: {
    name: 'Sunlectric Incentive Preset',
    fields: {
      x_name: nameField,
      x_code: { label: 'Code', type: 'char', required: true, index: true },
      x_company_id: companyField,
      x_active: { label: 'Active', type: 'boolean', required: true },
      x_current_version_id: {
        label: 'Current Version',
        type: 'many2one',
        relation: INCENTIVE_STUDIO_MODELS.presetVersion,
        onDelete: 'set null',
      },
    },
  },
  [INCENTIVE_STUDIO_MODELS.presetVersion]: {
    name: 'Sunlectric Incentive Preset Version',
    fields: {
      x_name: nameField,
      x_preset_id: {
        label: 'Preset',
        type: 'many2one',
        relation: INCENTIVE_STUDIO_MODELS.preset,
        required: true,
        index: true,
        onDelete: 'cascade',
      },
      x_company_id: companyField,
      x_version_number: { label: 'Version Number', type: 'integer', required: true },
      x_status: statusSelection('Status', [
        ['draft', 'Draft'],
        ['active', 'Active'],
        ['retired', 'Retired'],
      ]),
      x_schema_version: { label: 'Schema Version', type: 'char', required: true },
      x_rules_json: { label: 'Rules JSON', type: 'text', required: true, copied: false },
      x_rules_checksum: { label: 'Rules Checksum', type: 'char', required: true, index: true, copied: false },
      x_locked: { label: 'Locked', type: 'boolean', required: true, copied: false },
      x_activated_by_id: {
        label: 'Activated By',
        type: 'many2one',
        relation: 'res.users',
        onDelete: 'set null',
        copied: false,
      },
      x_activated_at: { label: 'Activated At', type: 'datetime', copied: false },
    },
  },
  [INCENTIVE_STUDIO_MODELS.employeeAssignment]: {
    name: 'Sunlectric Incentive Employee Assignment',
    fields: {
      x_name: nameField,
      x_employee_id: {
        label: 'Employee',
        type: 'many2one',
        relation: 'hr.employee',
        required: true,
        index: true,
        onDelete: 'restrict',
      },
      x_preset_version_id: {
        label: 'Preset Version',
        type: 'many2one',
        relation: INCENTIVE_STUDIO_MODELS.presetVersion,
        required: true,
        onDelete: 'restrict',
      },
      x_date_from: { label: 'Effective From', type: 'date', required: true, index: true },
      x_date_to: { label: 'Effective To', type: 'date', index: true },
      x_company_id: companyField,
      x_active: { label: 'Active', type: 'boolean', required: true },
    },
  },
  [INCENTIVE_STUDIO_MODELS.expenseAssignment]: {
    name: 'Sunlectric Incentive Expense Attribution',
    fields: {
      x_name: nameField,
      x_move_id: {
        label: 'Accounting Move',
        type: 'many2one',
        relation: 'account.move',
        required: true,
        index: true,
        onDelete: 'restrict',
      },
      x_employee_id: {
        label: 'Incentive Employee',
        type: 'many2one',
        relation: 'hr.employee',
        onDelete: 'restrict',
      },
      x_company_id: companyField,
      x_currency_id: currencyField,
      x_attributed_amount: moneyField('Attributed Amount'),
      x_status: statusSelection('Status', [
        ['unresolved', 'Unresolved'],
        ['assigned', 'Assigned'],
        ['void', 'Void'],
      ]),
      x_reason: { label: 'Reason', type: 'text', required: true },
      x_notes: { label: 'Notes', type: 'text' },
    },
  },
  [INCENTIVE_STUDIO_MODELS.commissionAssignment]: {
    name: 'Sunlectric Incentive Commission Attribution',
    fields: {
      x_name: nameField,
      x_move_line_id: {
        label: 'Commission Journal Line',
        type: 'many2one',
        relation: 'account.move.line',
        required: true,
        index: true,
        onDelete: 'restrict',
      },
      x_employee_id: {
        label: 'Incentive Employee',
        type: 'many2one',
        relation: 'hr.employee',
        onDelete: 'restrict',
      },
      x_company_id: companyField,
      x_currency_id: currencyField,
      x_attributed_amount: moneyField('Attributed Amount'),
      x_status: statusSelection('Status', [
        ['unresolved', 'Unresolved'],
        ['assigned', 'Assigned'],
        ['void', 'Void'],
      ]),
      x_reason: { label: 'Reason', type: 'text', required: true },
      x_notes: { label: 'Notes', type: 'text' },
    },
  },
  [INCENTIVE_STUDIO_MODELS.customerOwnerResolution]: {
    name: 'Sunlectric Incentive Owner Resolution',
    fields: {
      x_name: nameField,
      x_event_key: { label: 'Customer Event Key', type: 'char', required: true, index: true },
      x_employee_id: {
        label: 'Incentive Employee',
        type: 'many2one',
        relation: 'hr.employee',
        required: true,
        onDelete: 'restrict',
      },
      x_company_id: companyField,
      x_status: statusSelection('Status', [
        ['assigned', 'Assigned'],
        ['void', 'Void'],
      ]),
      x_reason: { label: 'Reason', type: 'text', required: true },
      x_notes: { label: 'Notes', type: 'text' },
    },
  },
  [INCENTIVE_STUDIO_MODELS.adjustment]: {
    name: 'Sunlectric Incentive Adjustment',
    fields: {
      x_name: nameField,
      x_calculation_id: {
        label: 'Calculation',
        type: 'many2one',
        relation: INCENTIVE_STUDIO_MODELS.calculation,
        required: true,
        index: true,
        onDelete: 'restrict',
      },
      x_employee_id: {
        label: 'Employee',
        type: 'many2one',
        relation: 'hr.employee',
        required: true,
        onDelete: 'restrict',
      },
      x_company_id: companyField,
      x_currency_id: currencyField,
      x_month: { label: 'Month', type: 'date', required: true, index: true },
      x_operation: statusSelection('Operation', [
        ['add', 'Add'],
        ['deduct', 'Deduct'],
      ]),
      x_amount: { ...moneyField('Amount'), required: true },
      x_reason: { label: 'Reason', type: 'text', required: true },
      x_notes: { label: 'Notes', type: 'text' },
    },
  },
  [INCENTIVE_STUDIO_MODELS.calculation]: {
    name: 'Sunlectric Incentive Calculation',
    fields: {
      x_name: nameField,
      x_employee_id: {
        label: 'Employee',
        type: 'many2one',
        relation: 'hr.employee',
        required: true,
        index: true,
        onDelete: 'restrict',
      },
      x_company_id: companyField,
      x_currency_id: currencyField,
      x_month: { label: 'Month', type: 'date', required: true, index: true },
      x_period_start: { label: 'Period Start', type: 'date', required: true },
      x_period_end: { label: 'Period End', type: 'date', required: true },
      x_preset_version_id: {
        label: 'Preset Version',
        type: 'many2one',
        relation: INCENTIVE_STUDIO_MODELS.presetVersion,
        required: true,
        onDelete: 'restrict',
      },
      x_revision: { label: 'Revision', type: 'integer', required: true },
      x_supersedes_id: {
        label: 'Supersedes',
        type: 'many2one',
        relation: INCENTIVE_STUDIO_MODELS.calculation,
        onDelete: 'restrict',
      },
      x_state: statusSelection('State', [
        ['draft', 'Draft'],
        ['review', 'In Review'],
        ['approved', 'Approved'],
        ['rejected', 'Rejected'],
        ['superseded', 'Superseded'],
      ]),
      x_engine_version: { label: 'Engine Version', type: 'char', required: true },
      x_rules_checksum: { label: 'Rules Checksum', type: 'char', required: true, copied: false },
      x_input_checksum: { label: 'Input Checksum', type: 'char', required: true, copied: false },
      x_rules_snapshot_json: { label: 'Rules Snapshot JSON', type: 'text', required: true, copied: false },
      x_input_snapshot_json: { label: 'Input and Source Snapshot JSON', type: 'text', required: true, copied: false },
      x_result_snapshot_json: { label: 'Result Snapshot JSON', type: 'text', required: true, copied: false },
      x_threshold_state_json: { label: 'Threshold State JSON', type: 'text', required: true, copied: false },
      x_slab_state_json: { label: 'Slab State JSON', type: 'text', required: true, copied: false },
      x_carry_state_json: { label: 'Carry State JSON', type: 'text', required: true, copied: false },
      x_salary_version_id: {
        label: 'Salary Version',
        type: 'many2one',
        relation: 'hr.version',
        onDelete: 'restrict',
      },
      x_salary_source_key: { label: 'Salary Source Key', type: 'char', required: true },
      x_salary_used: { ...moneyField('Salary Used'), required: true },
      x_carry_in: { ...moneyField('Carry In'), required: true },
      x_carry_out: { ...moneyField('Carry Out'), required: true },
      x_unpaid_base_in: { ...moneyField('Unpaid Base In'), required: true },
      x_unpaid_base_out: { ...moneyField('Unpaid Base Out'), required: true },
      x_actual_base: { ...moneyField('Actual Base'), required: true },
      x_raw_incentive: { ...moneyField('Raw Incentive'), required: true },
      x_adjustment_total: { ...moneyField('Adjustment Total'), required: true },
      x_final_incentive: { ...moneyField('Final Incentive'), required: true },
      x_reviewed_by_id: {
        label: 'Reviewed By',
        type: 'many2one',
        relation: 'res.users',
        onDelete: 'set null',
      },
      x_reviewed_at: { label: 'Reviewed At', type: 'datetime' },
      x_approved_by_id: {
        label: 'Approved By',
        type: 'many2one',
        relation: 'res.users',
        onDelete: 'set null',
        copied: false,
      },
      x_approved_at: { label: 'Approved At', type: 'datetime', copied: false },
      x_payment_state: statusSelection('Payment State', [
        ['unpaid', 'Unpaid'],
        ['partial', 'Partially Paid'],
        ['paid', 'Paid'],
      ]),
      x_paid_amount: { ...moneyField('Paid Amount'), required: true },
      x_review_notes: { label: 'Review Notes', type: 'text' },
    },
  },
  [INCENTIVE_STUDIO_MODELS.calculationSource]: {
    name: 'Sunlectric Incentive Calculation Source',
    fields: {
      x_name: nameField,
      x_calculation_id: {
        label: 'Calculation',
        type: 'many2one',
        relation: INCENTIVE_STUDIO_MODELS.calculation,
        required: true,
        index: true,
        onDelete: 'cascade',
      },
      x_company_id: companyField,
      x_currency_id: currencyField,
      x_source_model: { label: 'Source Model', type: 'char', required: true, index: true },
      x_source_record_id: { label: 'Source Record ID', type: 'integer', required: true, index: true },
      x_source_key: { label: 'Stable Source Key', type: 'char', required: true, index: true },
      x_source_category: statusSelection('Source Category', [
        ['invoice_sales', 'Invoice Sales'],
        ['credit_note_sales', 'Credit Note Sales'],
        ['cogs', 'COGS'],
        ['transport', 'Transport'],
        ['loading', 'Loading'],
        ['employee_expense', 'Employee Expense'],
        ['commission', 'Commission'],
        ['new_customer', 'New Customer Qualification'],
        ['repeat_customer', 'Repeat Customer Qualification'],
      ]),
      x_signed_amount: { ...moneyField('Signed Amount'), required: true },
      x_source_snapshot_json: { label: 'Source Snapshot JSON', type: 'text', required: true, copied: false },
    },
  },
  [INCENTIVE_STUDIO_MODELS.payment]: {
    name: 'Sunlectric Incentive Payment',
    fields: {
      x_name: nameField,
      x_calculation_id: {
        label: 'Approved Calculation',
        type: 'many2one',
        relation: INCENTIVE_STUDIO_MODELS.calculation,
        required: true,
        index: true,
        onDelete: 'restrict',
      },
      x_company_id: companyField,
      x_currency_id: currencyField,
      x_amount: { ...moneyField('Amount'), required: true },
      x_payment_date: { label: 'Payment Date', type: 'date', required: true },
      x_reference: { label: 'Payment Reference', type: 'char', required: true },
      x_status: statusSelection('Status', [
        ['recorded', 'Recorded'],
        ['reversed', 'Reversed'],
      ]),
      x_recorded_by_id: {
        label: 'Recorded By',
        type: 'many2one',
        relation: 'res.users',
        required: true,
        onDelete: 'restrict',
      },
      x_recorded_at: { label: 'Recorded At', type: 'datetime', required: true },
      x_notes: { label: 'Notes', type: 'text' },
    },
  },
};

export const INCENTIVE_STUDIO_FIELDS: Record<string, string[]> = Object.fromEntries(
  Object.entries(INCENTIVE_STUDIO_MODEL_DEFINITIONS).map(([model, definition]) => [
    model,
    Object.keys(definition.fields),
  ]),
);

interface IrModelRecord {
  id: number;
  model: string;
}

interface IrModelFieldRecord {
  model: string;
  name: string;
  ttype: StudioFieldType;
  relation: false | string;
  required: boolean;
  readonly: boolean;
  on_delete: false | string;
  currency_field: false | string;
  selection: false | string;
}

export interface StudioFieldMismatch {
  model: string;
  field: string;
  property: 'type' | 'relation' | 'required' | 'readonly' | 'onDelete' | 'currencyField' | 'selection';
  expected: string | boolean;
  actual: string | boolean;
}

export interface StudioSchemaStatus {
  ready: boolean;
  missingModels: string[];
  missingFields: Array<{ model: string; field: string }>;
  fieldMismatches: StudioFieldMismatch[];
}

export class StudioSchemaError extends Error {
  readonly status: StudioSchemaStatus;

  constructor(status: StudioSchemaStatus) {
    const missing = [
      ...status.missingModels,
      ...status.missingFields.map((item) => `${item.model}.${item.field}`),
      ...status.fieldMismatches.map((item) => (
        `${item.model}.${item.field}.${item.property} expected=${item.expected} actual=${item.actual}`
      )),
    ];
    super(`Sunlectric incentive Studio schema is incomplete: ${missing.join(', ')}`);
    this.name = 'StudioSchemaError';
    this.status = status;
  }
}

export async function inspectIncentiveStudioSchema(
  gateway: OdooGateway,
): Promise<StudioSchemaStatus> {
  const expectedModels = Object.values(INCENTIVE_STUDIO_MODELS);
  const models = await gateway.searchReadAll<IrModelRecord>(
    'ir.model',
    [['model', 'in', expectedModels]],
    ['id', 'model'],
  );
  const availableModels = new Set(models.map((model) => model.model));
  const missingModels = expectedModels.filter((model) => !availableModels.has(model));
  const fields = models.length === 0
    ? []
    : await gateway.searchReadAll<IrModelFieldRecord>(
        'ir.model.fields',
        [['model', 'in', models.map((model) => model.model)]],
        [
          'model', 'name', 'ttype', 'relation', 'required', 'readonly',
          'on_delete', 'currency_field', 'selection',
        ],
      );
  const availableFields = new Map(fields.map((field) => [`${field.model}.${field.name}`, field]));
  const missingFields: Array<{ model: string; field: string }> = [];
  const fieldMismatches: StudioFieldMismatch[] = [];
  for (const [model, definition] of Object.entries(INCENTIVE_STUDIO_MODEL_DEFINITIONS)) {
    if (!availableModels.has(model)) {
      continue;
    }
    for (const [fieldName, expected] of Object.entries(definition.fields)) {
      const actual = availableFields.get(`${model}.${fieldName}`);
      if (!actual) {
        missingFields.push({ model, field: fieldName });
        continue;
      }
      const checks: Array<{
        property: StudioFieldMismatch['property'];
        expected: string | boolean;
        actual: string | boolean;
      }> = [
        { property: 'type', expected: expected.type, actual: actual.ttype },
        { property: 'required', expected: expected.required ?? false, actual: actual.required },
        { property: 'readonly', expected: expected.readonly ?? false, actual: actual.readonly },
      ];
      if (expected.relation) {
        checks.push({
          property: 'relation',
          expected: expected.relation,
          actual: actual.relation || '',
        });
      }
      if (expected.onDelete) {
        checks.push({
          property: 'onDelete',
          expected: expected.onDelete,
          actual: actual.on_delete || '',
        });
      }
      if (expected.currencyField) {
        checks.push({
          property: 'currencyField',
          expected: expected.currencyField,
          actual: actual.currency_field || '',
        });
      }
      if (expected.selection) {
        checks.push({
          property: 'selection',
          expected: studioSelectionLiteral(expected.selection),
          actual: actual.selection || '',
        });
      }
      for (const check of checks) {
        if (check.expected !== check.actual) {
          fieldMismatches.push({ model, field: fieldName, ...check });
        }
      }
    }
  }
  return {
    ready: missingModels.length === 0
      && missingFields.length === 0
      && fieldMismatches.length === 0,
    missingModels,
    missingFields,
    fieldMismatches,
  };
}

export function studioSelectionLiteral(
  selection: ReadonlyArray<readonly [string, string]>,
): string {
  const quote = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  return `[${selection.map(([value, label]) => `(${quote(value)}, ${quote(label)})`).join(', ')}]`;
}

export async function assertIncentiveStudioSchema(gateway: OdooGateway): Promise<void> {
  const status = await inspectIncentiveStudioSchema(gateway);
  if (!status.ready) {
    throw new StudioSchemaError(status);
  }
}
