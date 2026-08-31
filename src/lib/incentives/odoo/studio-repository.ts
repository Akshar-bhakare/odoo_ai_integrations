import { createHash } from 'node:crypto';
import { calculateIncentives } from '../engine';
import { assertPresetSchema } from '../preset-schema';
import type {
  IncentiveEngineInput,
  IncentivePresetV1,
  MonthlyIncentiveResult,
} from '../types';
import { validatePreset } from '../validation';
import {
  assertIncentiveAuthorization,
  type IncentiveActor,
} from './authorization';
import type {
  CommissionAssignmentSource,
  CustomerOwnerResolutionSource,
  ExpenseAssignmentSource,
} from './contracts';
import type { IncentiveAttributionReader } from './extraction';
import { defaultOdooGateway, type OdooGateway } from './gateway';
import {
  assertIncentiveStudioSchema,
  INCENTIVE_STUDIO_MODELS,
  inspectIncentiveStudioSchema,
} from './studio-schema';
import { canonicalJson } from '../snapshot-json';

type OdooMany2one = false | [number, string];

interface ExpenseAssignmentRecord {
  id: number;
  x_move_id: OdooMany2one;
  x_employee_id: OdooMany2one;
  x_status: ExpenseAssignmentSource['status'];
}

interface CommissionAssignmentRecord {
  id: number;
  x_move_line_id: OdooMany2one;
  x_employee_id: OdooMany2one;
  x_status: CommissionAssignmentSource['status'];
}

interface OwnerResolutionRecord {
  id: number;
  x_event_key: string;
  x_employee_id: OdooMany2one;
  x_status: CustomerOwnerResolutionSource['status'];
}

interface PresetRecord {
  id: number;
  x_name: string;
  x_company_id: OdooMany2one;
}

interface PresetVersionRecord {
  id: number;
  x_preset_id: OdooMany2one;
  x_company_id: OdooMany2one;
  x_version_number: number;
  x_status: 'draft' | 'active' | 'retired';
  x_rules_json: string;
  x_rules_checksum: string;
  x_locked: boolean;
}

interface EmployeeAssignmentRecord {
  id: number;
  x_employee_id: OdooMany2one;
  x_preset_version_id: OdooMany2one;
  x_company_id: OdooMany2one;
  x_date_from: string;
  x_date_to: string | false;
  x_active: boolean;
}

interface CalculationRecord {
  id: number;
  x_employee_id: OdooMany2one;
  x_company_id: OdooMany2one;
  x_currency_id: OdooMany2one;
  x_month: string;
  x_preset_version_id: OdooMany2one;
  x_revision: number;
  x_supersedes_id: OdooMany2one;
  x_state: 'draft' | 'review' | 'approved' | 'rejected' | 'superseded';
  x_engine_version: string;
  x_final_incentive: number;
}

interface PersistedSourceAudit {
  sourceModel: string;
  sourceRecordId: number;
  sourceKey: string;
  category:
    | 'invoice_sales'
    | 'credit_note_sales'
    | 'cogs'
    | 'transport'
    | 'loading'
    | 'employee_expense'
    | 'commission'
    | 'new_customer'
    | 'repeat_customer';
  signedAmount: number;
  snapshot: unknown;
}

export interface DraftCalculationParams {
  actor: IncentiveActor;
  name: string;
  presetVersionId: number;
  revision: number;
  supersedesId?: number | null;
  input: IncentiveEngineInput;
  sources: PersistedSourceAudit[];
  engineVersion: string;
}

function many2oneId(value: OdooMany2one): number | null {
  return value === false ? null : value[0];
}

function checksum(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function utcNowForOdoo(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function monthDate(month: string): string {
  return `${month}-01`;
}

function monthEnd(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function requireSingleMonth(input: IncentiveEngineInput): string {
  if (input.months.length !== 1) {
    throw new Error('A persisted calculation revision must contain exactly one calendar month');
  }
  return input.months[0].month;
}

function resultStateSnapshots(result: MonthlyIncentiveResult): {
  threshold: string;
  slab: string;
  carry: string;
} {
  const main = result.mainIncentive;
  return {
    threshold: canonicalJson({
      flatThreshold: main.flatThreshold,
      firstSlabThreshold: main.firstSlabThreshold,
      requiredThreshold: main.requiredThreshold,
      thresholdMet: main.thresholdMet,
      currentRecognizedBase: main.currentRecognizedBase,
      eligibleIncentiveBase: main.eligibleIncentiveBase,
    }),
    slab: canonicalJson({
      structure: main.structure,
      slabSelectionBase: main.slabSelectionBase,
      achievedRate: main.achievedRate,
    }),
    carry: canonicalJson({
      carryIn: main.carryIn,
      carryOut: main.carryOut,
      carryConsumed: main.carryConsumed,
      accumulatedUnpaidBaseIn: main.accumulatedUnpaidBaseIn,
      accumulatedUnpaidBaseOut: main.accumulatedUnpaidBaseOut,
      stateAfter: result.stateAfter,
    }),
  };
}

export class StudioIncentiveRepository implements IncentiveAttributionReader {
  constructor(private readonly gateway: OdooGateway = defaultOdooGateway) {}

  inspectSchema() {
    return inspectIncentiveStudioSchema(this.gateway);
  }

  private async assertReady(): Promise<void> {
    await assertIncentiveStudioSchema(this.gateway);
  }

  private async one<T>(model: string, id: number, fields: string[]): Promise<T> {
    const records = await this.gateway.searchRead<T>(model, [['id', '=', id]], fields, { limit: 1 });
    if (records.length !== 1) {
      throw new Error(`${model} record ${id} was not found`);
    }
    return records[0];
  }

  private async companyCurrencyId(companyId: number): Promise<number> {
    const company = await this.one<{ currency_id: OdooMany2one }>(
      'res.company',
      companyId,
      ['currency_id'],
    );
    const currencyId = many2oneId(company.currency_id);
    if (currencyId === null) {
      throw new Error(`Company ${companyId} has no currency`);
    }
    return currencyId;
  }

  private async assertEmployeeCompany(employeeId: number, companyId: number): Promise<void> {
    const employee = await this.one<{ company_id: OdooMany2one }>(
      'hr.employee',
      employeeId,
      ['company_id'],
    );
    if (many2oneId(employee.company_id) !== companyId) {
      throw new Error(`Employee ${employeeId} does not belong to company ${companyId}`);
    }
  }

  async getExpenseAssignments(): Promise<ExpenseAssignmentSource[]> {
    await this.assertReady();
    const records = await this.gateway.searchReadAll<ExpenseAssignmentRecord>(
      INCENTIVE_STUDIO_MODELS.expenseAssignment,
      [['x_status', '!=', 'void']],
      ['id', 'x_move_id', 'x_employee_id', 'x_status'],
    );
    return records.map((record) => ({
      id: record.id,
      moveId: many2oneId(record.x_move_id)!,
      employeeId: many2oneId(record.x_employee_id),
      status: record.x_status,
    }));
  }

  async getCommissionAssignments(): Promise<CommissionAssignmentSource[]> {
    await this.assertReady();
    const records = await this.gateway.searchReadAll<CommissionAssignmentRecord>(
      INCENTIVE_STUDIO_MODELS.commissionAssignment,
      [['x_status', '!=', 'void']],
      ['id', 'x_move_line_id', 'x_employee_id', 'x_status'],
    );
    return records.map((record) => ({
      id: record.id,
      moveLineId: many2oneId(record.x_move_line_id)!,
      employeeId: many2oneId(record.x_employee_id),
      status: record.x_status,
    }));
  }

  async getCustomerOwnerResolutions(): Promise<CustomerOwnerResolutionSource[]> {
    await this.assertReady();
    const records = await this.gateway.searchReadAll<OwnerResolutionRecord>(
      INCENTIVE_STUDIO_MODELS.customerOwnerResolution,
      [['x_status', '!=', 'void']],
      ['id', 'x_event_key', 'x_employee_id', 'x_status'],
    );
    return records.map((record) => ({
      id: record.id,
      eventKey: record.x_event_key,
      employeeId: many2oneId(record.x_employee_id)!,
      status: record.x_status,
    }));
  }

  async createPreset(params: {
    actor: IncentiveActor;
    name: string;
    code: string;
    companyId: number;
  }): Promise<number> {
    await this.assertReady();
    assertIncentiveAuthorization(params.actor, 'manage_presets', params.companyId);
    const existing = await this.gateway.searchRead<{ id: number }>(
      INCENTIVE_STUDIO_MODELS.preset,
      [['x_code', '=', params.code], ['x_company_id', '=', params.companyId]],
      ['id'],
      { limit: 1 },
    );
    if (existing.length > 0) {
      throw new Error(`Preset code ${params.code} already exists in company ${params.companyId}`);
    }
    const ids = await this.gateway.create<number[]>(INCENTIVE_STUDIO_MODELS.preset, [{
      x_name: params.name,
      x_code: params.code,
      x_company_id: params.companyId,
      x_active: true,
    }]);
    return ids[0];
  }

  async createPresetVersion(params: {
    actor: IncentiveActor;
    presetId: number;
    versionNumber: number;
    rules: IncentivePresetV1;
  }): Promise<number> {
    await this.assertReady();
    assertPresetSchema(params.rules);
    validatePreset(params.rules);
    const preset = await this.one<PresetRecord>(
      INCENTIVE_STUDIO_MODELS.preset,
      params.presetId,
      ['x_name', 'x_company_id'],
    );
    const companyId = many2oneId(preset.x_company_id)!;
    assertIncentiveAuthorization(params.actor, 'manage_presets', companyId);
    const existing = await this.gateway.searchRead<{ id: number }>(
      INCENTIVE_STUDIO_MODELS.presetVersion,
      [['x_preset_id', '=', params.presetId], ['x_version_number', '=', params.versionNumber]],
      ['id'],
      { limit: 1 },
    );
    if (existing.length > 0) {
      throw new Error(`Preset ${params.presetId} already has version ${params.versionNumber}`);
    }
    const ids = await this.gateway.create<number[]>(INCENTIVE_STUDIO_MODELS.presetVersion, [{
      x_name: `${params.rules.name} v${params.versionNumber}`,
      x_preset_id: params.presetId,
      x_company_id: companyId,
      x_version_number: params.versionNumber,
      x_status: 'draft',
      x_schema_version: params.rules.schemaVersion,
      x_rules_json: canonicalJson(params.rules),
      x_rules_checksum: checksum(params.rules),
      x_locked: false,
    }]);
    return ids[0];
  }

  async updateDraftPresetVersion(params: {
    actor: IncentiveActor;
    versionId: number;
    rules: IncentivePresetV1;
  }): Promise<void> {
    await this.assertReady();
    assertPresetSchema(params.rules);
    validatePreset(params.rules);
    const version = await this.one<PresetVersionRecord>(
      INCENTIVE_STUDIO_MODELS.presetVersion,
      params.versionId,
      ['x_preset_id', 'x_company_id', 'x_version_number', 'x_status', 'x_rules_json', 'x_rules_checksum', 'x_locked'],
    );
    const companyId = many2oneId(version.x_company_id)!;
    assertIncentiveAuthorization(params.actor, 'manage_presets', companyId);
    if (version.x_status !== 'draft' || version.x_locked) {
      throw new Error(`Preset version ${params.versionId} is immutable`);
    }
    await this.gateway.write(INCENTIVE_STUDIO_MODELS.presetVersion, [params.versionId], {
      x_name: `${params.rules.name} v${version.x_version_number}`,
      x_schema_version: params.rules.schemaVersion,
      x_rules_json: canonicalJson(params.rules),
      x_rules_checksum: checksum(params.rules),
    });
  }

  async activatePresetVersion(params: {
    actor: IncentiveActor;
    versionId: number;
  }): Promise<void> {
    await this.assertReady();
    const version = await this.one<PresetVersionRecord>(
      INCENTIVE_STUDIO_MODELS.presetVersion,
      params.versionId,
      ['x_preset_id', 'x_company_id', 'x_version_number', 'x_status', 'x_rules_json', 'x_rules_checksum', 'x_locked'],
    );
    const companyId = many2oneId(version.x_company_id)!;
    assertIncentiveAuthorization(params.actor, 'manage_presets', companyId);
    if (version.x_status !== 'draft' || version.x_locked) {
      throw new Error(`Preset version ${params.versionId} cannot be activated from ${version.x_status}`);
    }
    const rules = JSON.parse(version.x_rules_json) as IncentivePresetV1;
    assertPresetSchema(rules);
    validatePreset(rules);
    if (checksum(rules) !== version.x_rules_checksum) {
      throw new Error(`Preset version ${params.versionId} checksum does not match its rules JSON`);
    }
    await this.gateway.write(INCENTIVE_STUDIO_MODELS.presetVersion, [params.versionId], {
      x_status: 'active',
      x_locked: true,
      x_activated_by_id: params.actor.userId,
      x_activated_at: utcNowForOdoo(),
    });
    await this.gateway.write(INCENTIVE_STUDIO_MODELS.preset, [many2oneId(version.x_preset_id)!], {
      x_current_version_id: params.versionId,
      x_active: true,
    });
  }

  async assignEmployeePreset(params: {
    actor: IncentiveActor;
    employeeId: number;
    presetVersionId: number;
    companyId: number;
    effectiveFrom: string;
    effectiveTo?: string | null;
  }): Promise<number> {
    await this.assertReady();
    assertIncentiveAuthorization(params.actor, 'manage_assignments', params.companyId);
    await this.assertEmployeeCompany(params.employeeId, params.companyId);
    const version = await this.one<PresetVersionRecord>(
      INCENTIVE_STUDIO_MODELS.presetVersion,
      params.presetVersionId,
      ['x_preset_id', 'x_company_id', 'x_version_number', 'x_status', 'x_rules_json', 'x_rules_checksum', 'x_locked'],
    );
    if (version.x_status !== 'active' || !version.x_locked) {
      throw new Error('Employee assignments require an active locked preset version');
    }
    if (many2oneId(version.x_company_id) !== params.companyId) {
      throw new Error('Employee and preset version companies do not match');
    }
    const overlap = await this.gateway.searchRead<{ id: number }>(
      INCENTIVE_STUDIO_MODELS.employeeAssignment,
      [
        ['x_employee_id', '=', params.employeeId],
        ['x_company_id', '=', params.companyId],
        ['x_active', '=', true],
        ['x_date_from', '<=', params.effectiveTo ?? '9999-12-31'],
        '|',
        ['x_date_to', '=', false],
        ['x_date_to', '>=', params.effectiveFrom],
      ],
      ['id'],
      { limit: 1 },
    );
    if (overlap.length > 0) {
      throw new Error('Employee already has an overlapping active incentive assignment');
    }
    const ids = await this.gateway.create<number[]>(INCENTIVE_STUDIO_MODELS.employeeAssignment, [{
      x_name: `Employee ${params.employeeId} / Version ${params.presetVersionId}`,
      x_employee_id: params.employeeId,
      x_preset_version_id: params.presetVersionId,
      x_date_from: params.effectiveFrom,
      x_date_to: params.effectiveTo ?? false,
      x_company_id: params.companyId,
      x_active: true,
    }]);
    return ids[0];
  }

  async updateEmployeePresetAssignment(params: {
    actor: IncentiveActor;
    assignmentId: number;
    presetVersionId?: number;
    effectiveFrom: string;
    effectiveTo?: string | null;
    active: boolean;
  }): Promise<void> {
    await this.assertReady();
    const assignment = await this.one<EmployeeAssignmentRecord>(
      INCENTIVE_STUDIO_MODELS.employeeAssignment,
      params.assignmentId,
      [
        'x_employee_id', 'x_preset_version_id', 'x_company_id',
        'x_date_from', 'x_date_to', 'x_active',
      ],
    );
    const companyId = many2oneId(assignment.x_company_id)!;
    const employeeId = many2oneId(assignment.x_employee_id)!;
    assertIncentiveAuthorization(params.actor, 'manage_assignments', companyId);
    const presetVersionId = params.presetVersionId ?? many2oneId(assignment.x_preset_version_id)!;
    const version = await this.one<PresetVersionRecord>(
      INCENTIVE_STUDIO_MODELS.presetVersion,
      presetVersionId,
      ['x_preset_id', 'x_company_id', 'x_version_number', 'x_status', 'x_rules_json', 'x_rules_checksum', 'x_locked'],
    );
    if (version.x_status !== 'active' || !version.x_locked
      || many2oneId(version.x_company_id) !== companyId) {
      throw new Error('Assignment requires an active locked preset version in the same company');
    }
    if (params.active) {
      const overlap = await this.gateway.searchRead<{ id: number }>(
        INCENTIVE_STUDIO_MODELS.employeeAssignment,
        [
          ['id', '!=', params.assignmentId],
          ['x_employee_id', '=', employeeId],
          ['x_company_id', '=', companyId],
          ['x_active', '=', true],
          ['x_date_from', '<=', params.effectiveTo ?? '9999-12-31'],
          '|',
          ['x_date_to', '=', false],
          ['x_date_to', '>=', params.effectiveFrom],
        ],
        ['id'],
        { limit: 1 },
      );
      if (overlap.length > 0) {
        throw new Error('Employee already has an overlapping active incentive assignment');
      }
    }
    await this.gateway.write(INCENTIVE_STUDIO_MODELS.employeeAssignment, [params.assignmentId], {
      x_preset_version_id: presetVersionId,
      x_date_from: params.effectiveFrom,
      x_date_to: params.effectiveTo ?? false,
      x_active: params.active,
    });
  }

  async assignExpense(params: {
    actor: IncentiveActor;
    moveId: number;
    employeeId: number;
    attributedAmount: number;
    reason: string;
    notes?: string;
  }): Promise<number> {
    await this.assertReady();
    const move = await this.one<{
      company_id: OdooMany2one;
      currency_id: OdooMany2one;
      state: string;
    }>('account.move', params.moveId, ['company_id', 'currency_id', 'state']);
    const companyId = many2oneId(move.company_id)!;
    assertIncentiveAuthorization(params.actor, 'attribute_expense', companyId);
    if (move.state !== 'posted') {
      throw new Error('Only posted accounting moves can be attributed as employee expenses');
    }
    await this.assertEmployeeCompany(params.employeeId, companyId);
    const existing = await this.gateway.searchRead<{ id: number; x_status: string }>(
      INCENTIVE_STUDIO_MODELS.expenseAssignment,
      [['x_move_id', '=', params.moveId], ['x_status', '!=', 'void']],
      ['id', 'x_status'],
      { limit: 2 },
    );
    if (existing.length > 1 || existing[0]?.x_status === 'assigned') {
      throw new Error(`Expense move ${params.moveId} already has an active incentive assignment`);
    }
    const values = {
      x_name: `Expense ${params.moveId} -> Employee ${params.employeeId}`,
      x_move_id: params.moveId,
      x_employee_id: params.employeeId,
      x_company_id: companyId,
      x_currency_id: many2oneId(move.currency_id) ?? await this.companyCurrencyId(companyId),
      x_attributed_amount: params.attributedAmount,
      x_status: 'assigned',
      x_reason: params.reason,
      x_notes: params.notes ?? false,
    };
    if (existing.length === 1) {
      await this.gateway.write(INCENTIVE_STUDIO_MODELS.expenseAssignment, [existing[0].id], values);
      return existing[0].id;
    }
    const ids = await this.gateway.create<number[]>(INCENTIVE_STUDIO_MODELS.expenseAssignment, [values]);
    return ids[0];
  }

  async assignCommission(params: {
    actor: IncentiveActor;
    moveLineId: number;
    employeeId: number;
    reason: string;
    notes?: string;
  }): Promise<number> {
    await this.assertReady();
    const line = await this.one<{
      company_id: OdooMany2one;
      currency_id: OdooMany2one;
      parent_state: string;
      account_id: OdooMany2one;
      balance: number;
    }>('account.move.line', params.moveLineId, [
      'company_id', 'currency_id', 'parent_state', 'account_id', 'balance',
    ]);
    const companyId = many2oneId(line.company_id)!;
    assertIncentiveAuthorization(params.actor, 'attribute_commission', companyId);
    if (line.parent_state !== 'posted') {
      throw new Error('Only posted commission lines can be attributed');
    }
    const account = await this.one<{ code: string }>('account.account', many2oneId(line.account_id)!, ['code']);
    if (account.code !== '211810') {
      throw new Error(`Journal line ${params.moveLineId} is not from commission account 211810`);
    }
    await this.assertEmployeeCompany(params.employeeId, companyId);
    const existing = await this.gateway.searchRead<{ id: number; x_status: string }>(
      INCENTIVE_STUDIO_MODELS.commissionAssignment,
      [['x_move_line_id', '=', params.moveLineId], ['x_status', '!=', 'void']],
      ['id', 'x_status'],
      { limit: 2 },
    );
    if (existing.length > 1 || existing[0]?.x_status === 'assigned') {
      throw new Error(`Commission line ${params.moveLineId} already has an active incentive assignment`);
    }
    const values = {
      x_name: `Commission ${params.moveLineId} -> Employee ${params.employeeId}`,
      x_move_line_id: params.moveLineId,
      x_employee_id: params.employeeId,
      x_company_id: companyId,
      x_currency_id: many2oneId(line.currency_id) ?? await this.companyCurrencyId(companyId),
      x_attributed_amount: line.balance,
      x_status: 'assigned',
      x_reason: params.reason,
      x_notes: params.notes ?? false,
    };
    if (existing.length === 1) {
      await this.gateway.write(INCENTIVE_STUDIO_MODELS.commissionAssignment, [existing[0].id], values);
      return existing[0].id;
    }
    const ids = await this.gateway.create<number[]>(INCENTIVE_STUDIO_MODELS.commissionAssignment, [values]);
    return ids[0];
  }

  async resolveCustomerOwner(params: {
    actor: IncentiveActor;
    eventKey: string;
    employeeId: number;
    companyId: number;
    reason: string;
    notes?: string;
  }): Promise<number> {
    await this.assertReady();
    assertIncentiveAuthorization(params.actor, 'resolve_customer_owner', params.companyId);
    await this.assertEmployeeCompany(params.employeeId, params.companyId);
    const existing = await this.gateway.searchRead<{ id: number }>(
      INCENTIVE_STUDIO_MODELS.customerOwnerResolution,
      [['x_event_key', '=', params.eventKey], ['x_status', '!=', 'void']],
      ['id'],
      { limit: 1 },
    );
    if (existing.length > 0) {
      throw new Error(`Customer event ${params.eventKey} already has an active owner resolution`);
    }
    const ids = await this.gateway.create<number[]>(INCENTIVE_STUDIO_MODELS.customerOwnerResolution, [{
      x_name: params.eventKey,
      x_event_key: params.eventKey,
      x_employee_id: params.employeeId,
      x_company_id: params.companyId,
      x_status: 'assigned',
      x_reason: params.reason,
      x_notes: params.notes ?? false,
    }]);
    return ids[0];
  }

  async createAdjustment(params: {
    actor: IncentiveActor;
    calculationId: number;
    operation: 'add' | 'deduct';
    amount: number;
    reason: string;
    notes?: string;
  }): Promise<number> {
    await this.assertReady();
    const calculation = await this.one<CalculationRecord>(
      INCENTIVE_STUDIO_MODELS.calculation,
      params.calculationId,
      ['x_employee_id', 'x_company_id', 'x_currency_id', 'x_month', 'x_preset_version_id', 'x_revision', 'x_state', 'x_final_incentive'],
    );
    const companyId = many2oneId(calculation.x_company_id)!;
    assertIncentiveAuthorization(params.actor, 'adjust_calculation', companyId);
    if (!['draft', 'review'].includes(calculation.x_state)) {
      throw new Error('Adjustments can only be added to draft or review calculations');
    }
    if (!(params.amount > 0)) {
      throw new Error('Adjustment amount must be positive');
    }
    const employeeId = many2oneId(calculation.x_employee_id)!;
    const ids = await this.gateway.create<number[]>(INCENTIVE_STUDIO_MODELS.adjustment, [{
      x_name: `${params.operation} ${params.amount}`,
      x_calculation_id: params.calculationId,
      x_employee_id: employeeId,
      x_company_id: companyId,
      x_currency_id: many2oneId(calculation.x_currency_id),
      x_month: calculation.x_month,
      x_operation: params.operation,
      x_amount: params.amount,
      x_reason: params.reason,
      x_notes: params.notes ?? false,
    }]);
    return ids[0];
  }

  private async assertPresetVersionForInput(
    presetVersionId: number,
    input: IncentiveEngineInput,
  ): Promise<PresetVersionRecord> {
    const version = await this.one<PresetVersionRecord>(
      INCENTIVE_STUDIO_MODELS.presetVersion,
      presetVersionId,
      ['x_preset_id', 'x_company_id', 'x_version_number', 'x_status', 'x_rules_json', 'x_rules_checksum', 'x_locked'],
    );
    if (version.x_status !== 'active' || !version.x_locked) {
      throw new Error('Calculations require an active locked preset version');
    }
    assertPresetSchema(input.preset);
    validatePreset(input.preset);
    if (many2oneId(version.x_company_id) !== input.companyId) {
      throw new Error('Calculation input and preset version companies do not match');
    }
    if (checksum(input.preset) !== version.x_rules_checksum) {
      throw new Error('Calculation preset does not match the immutable preset version checksum');
    }
    return version;
  }

  private calculationValues(params: {
    input: IncentiveEngineInput;
    presetVersionId: number;
    revision: number;
    supersedesId?: number | null;
    engineVersion: string;
    currencyId: number;
    result: MonthlyIncentiveResult;
    state: 'draft' | 'approved';
    actor: IncentiveActor;
  }): Record<string, unknown> {
    const { result } = params;
    const snapshots = resultStateSnapshots(result);
    const salaryVersionId = result.mainIncentive.salaryVersionId;
    return {
      x_employee_id: params.input.employeeId,
      x_company_id: params.input.companyId,
      x_currency_id: params.currencyId,
      x_month: monthDate(result.month),
      x_period_start: monthDate(result.month),
      x_period_end: monthEnd(result.month),
      x_preset_version_id: params.presetVersionId,
      x_revision: params.revision,
      x_supersedes_id: params.supersedesId ?? false,
      x_state: params.state,
      x_engine_version: params.engineVersion,
      x_rules_checksum: checksum(params.input.preset),
      x_input_checksum: checksum(params.input),
      x_rules_snapshot_json: canonicalJson(params.input.preset),
      x_input_snapshot_json: canonicalJson(params.input),
      x_result_snapshot_json: canonicalJson(result),
      x_threshold_state_json: snapshots.threshold,
      x_slab_state_json: snapshots.slab,
      x_carry_state_json: snapshots.carry,
      x_salary_version_id: typeof salaryVersionId === 'number' ? salaryVersionId : false,
      x_salary_source_key: String(salaryVersionId),
      x_salary_used: result.mainIncentive.salaryUsed,
      x_carry_in: result.mainIncentive.carryIn,
      x_carry_out: result.mainIncentive.carryOut,
      x_unpaid_base_in: result.mainIncentive.accumulatedUnpaidBaseIn,
      x_unpaid_base_out: result.mainIncentive.accumulatedUnpaidBaseOut,
      x_actual_base: result.accounting.actualBase,
      x_raw_incentive: result.calculatedIncentive,
      x_adjustment_total: result.adjustmentTotal,
      x_final_incentive: result.finalIncentive,
      x_payment_state: 'unpaid',
      x_paid_amount: 0,
      ...(params.state === 'approved' ? {
        x_approved_by_id: params.actor.userId,
        x_approved_at: utcNowForOdoo(),
      } : {}),
    };
  }

  private async replaceCalculationSources(params: {
    calculationId: number;
    companyId: number;
    currencyId: number;
    sources: PersistedSourceAudit[];
  }): Promise<void> {
    const existing = await this.gateway.searchReadAll<{ id: number }>(
      INCENTIVE_STUDIO_MODELS.calculationSource,
      [['x_calculation_id', '=', params.calculationId]],
      ['id'],
    );
    if (existing.length > 0) {
      await this.gateway.unlink(
        INCENTIVE_STUDIO_MODELS.calculationSource,
        existing.map((record) => record.id),
      );
    }
    if (params.sources.length === 0) {
      return;
    }
    await this.gateway.create<number[]>(
      INCENTIVE_STUDIO_MODELS.calculationSource,
      params.sources.map((source) => ({
        x_name: source.sourceKey,
        x_calculation_id: params.calculationId,
        x_company_id: params.companyId,
        x_currency_id: params.currencyId,
        x_source_model: source.sourceModel,
        x_source_record_id: source.sourceRecordId,
        x_source_key: source.sourceKey,
        x_source_category: source.category,
        x_signed_amount: source.signedAmount,
        x_source_snapshot_json: canonicalJson(source.snapshot),
      })),
    );
  }

  async createDraftCalculation(params: DraftCalculationParams): Promise<number> {
    await this.assertReady();
    assertIncentiveAuthorization(params.actor, 'review_calculation', params.input.companyId);
    const month = requireSingleMonth(params.input);
    await this.assertEmployeeCompany(params.input.employeeId, params.input.companyId);
    await this.assertPresetVersionForInput(params.presetVersionId, params.input);
    const existing = await this.gateway.searchRead<{ id: number }>(
      INCENTIVE_STUDIO_MODELS.calculation,
      [
        ['x_employee_id', '=', params.input.employeeId],
        ['x_month', '=', monthDate(month)],
        ['x_revision', '=', params.revision],
      ],
      ['id'],
      { limit: 1 },
    );
    if (existing.length > 0) {
      throw new Error('Calculation revision already exists');
    }
    const result = calculateIncentives(params.input).months[0];
    const currencyId = await this.companyCurrencyId(params.input.companyId);
    const ids = await this.gateway.create<number[]>(INCENTIVE_STUDIO_MODELS.calculation, [{
      x_name: params.name,
      ...this.calculationValues({
        ...params,
        currencyId,
        result,
        state: 'draft',
      }),
    }]);
    await this.replaceCalculationSources({
      calculationId: ids[0],
      companyId: params.input.companyId,
      currencyId,
      sources: params.sources,
    });
    return ids[0];
  }

  async recalculateDraft(params: {
    actor: IncentiveActor;
    calculationId: number;
    input: IncentiveEngineInput;
    sources: PersistedSourceAudit[];
  }): Promise<void> {
    await this.assertReady();
    const calculation = await this.one<CalculationRecord>(
      INCENTIVE_STUDIO_MODELS.calculation,
      params.calculationId,
      [
        'x_employee_id', 'x_company_id', 'x_currency_id', 'x_month',
        'x_preset_version_id', 'x_revision', 'x_supersedes_id', 'x_state',
        'x_engine_version', 'x_final_incentive',
      ],
    );
    const companyId = many2oneId(calculation.x_company_id)!;
    assertIncentiveAuthorization(params.actor, 'review_calculation', companyId);
    if (!['draft', 'review'].includes(calculation.x_state)) {
      throw new Error(`Calculation ${params.calculationId} cannot be recalculated from ${calculation.x_state}`);
    }
    const month = requireSingleMonth(params.input);
    if (params.input.employeeId !== many2oneId(calculation.x_employee_id)
      || params.input.companyId !== companyId
      || monthDate(month) !== calculation.x_month) {
      throw new Error('Fresh recalculation input does not match the persisted calculation identity');
    }
    const presetVersionId = many2oneId(calculation.x_preset_version_id)!;
    await this.assertPresetVersionForInput(presetVersionId, params.input);
    const engineResult = calculateIncentives(params.input);
    const result = engineResult.months[0];
    const currencyId = many2oneId(calculation.x_currency_id)!;
    await this.replaceCalculationSources({
      calculationId: params.calculationId,
      companyId,
      currencyId,
      sources: params.sources,
    });
    await this.gateway.write(INCENTIVE_STUDIO_MODELS.calculation, [params.calculationId], {
      ...this.calculationValues({
        input: params.input,
        presetVersionId,
        revision: calculation.x_revision,
        supersedesId: many2oneId(calculation.x_supersedes_id),
        engineVersion: calculation.x_engine_version,
        currencyId,
        result,
        state: 'draft',
        actor: params.actor,
      }),
      x_reviewed_by_id: false,
      x_reviewed_at: false,
    });
  }

  async submitCalculationForReview(params: {
    actor: IncentiveActor;
    calculationId: number;
  }): Promise<void> {
    await this.assertReady();
    const calculation = await this.one<CalculationRecord>(
      INCENTIVE_STUDIO_MODELS.calculation,
      params.calculationId,
      [
        'x_employee_id', 'x_company_id', 'x_currency_id', 'x_month',
        'x_preset_version_id', 'x_revision', 'x_supersedes_id', 'x_state',
        'x_engine_version', 'x_final_incentive',
      ],
    );
    const companyId = many2oneId(calculation.x_company_id)!;
    assertIncentiveAuthorization(params.actor, 'review_calculation', companyId);
    if (calculation.x_state !== 'draft') {
      throw new Error('Only draft calculations can be submitted for review');
    }
    await this.gateway.write(INCENTIVE_STUDIO_MODELS.calculation, [params.calculationId], {
      x_state: 'review',
      x_reviewed_by_id: params.actor.userId,
      x_reviewed_at: utcNowForOdoo(),
    });
  }

  async approveCalculation(params: {
    actor: IncentiveActor;
    calculationId: number;
    loadFreshInput: () => Promise<IncentiveEngineInput>;
    loadFreshSources: () => Promise<PersistedSourceAudit[]>;
  }): Promise<void> {
    await this.assertReady();
    const calculation = await this.one<CalculationRecord>(
      INCENTIVE_STUDIO_MODELS.calculation,
      params.calculationId,
      [
        'x_employee_id', 'x_company_id', 'x_currency_id', 'x_month',
        'x_preset_version_id', 'x_revision', 'x_supersedes_id', 'x_state',
        'x_engine_version', 'x_final_incentive',
      ],
    );
    const companyId = many2oneId(calculation.x_company_id)!;
    assertIncentiveAuthorization(params.actor, 'approve_calculation', companyId);
    if (calculation.x_state !== 'review') {
      throw new Error(`Calculation ${params.calculationId} cannot be approved from ${calculation.x_state}`);
    }
    const input = await params.loadFreshInput();
    const month = requireSingleMonth(input);
    if (input.employeeId !== many2oneId(calculation.x_employee_id)
      || input.companyId !== companyId
      || monthDate(month) !== calculation.x_month) {
      throw new Error('Fresh approval input does not match the persisted calculation identity');
    }
    const presetVersionId = many2oneId(calculation.x_preset_version_id)!;
    await this.assertPresetVersionForInput(presetVersionId, input);
    const engineResult = calculateIncentives(input);
    if (engineResult.resolutionIssues.length > 0) {
      throw new Error('Unresolved incentive sources block calculation approval');
    }
    const result = engineResult.months[0];
    const sources = await params.loadFreshSources();
    const currencyId = many2oneId(calculation.x_currency_id)!;
    await this.replaceCalculationSources({
      calculationId: params.calculationId,
      companyId,
      currencyId,
      sources,
    });
    await this.gateway.write(INCENTIVE_STUDIO_MODELS.calculation, [params.calculationId], {
      ...this.calculationValues({
        input,
        presetVersionId,
        revision: calculation.x_revision,
        supersedesId: many2oneId(calculation.x_supersedes_id),
        engineVersion: calculation.x_engine_version,
        currencyId,
        result,
        state: 'approved',
        actor: params.actor,
      }),
    });
  }

  async recordPayment(params: {
    actor: IncentiveActor;
    calculationId: number;
    amount: number;
    paymentDate: string;
    reference: string;
    notes?: string;
  }): Promise<number> {
    await this.assertReady();
    const calculation = await this.one<CalculationRecord>(
      INCENTIVE_STUDIO_MODELS.calculation,
      params.calculationId,
      ['x_employee_id', 'x_company_id', 'x_currency_id', 'x_month', 'x_preset_version_id', 'x_revision', 'x_state', 'x_final_incentive'],
    );
    const companyId = many2oneId(calculation.x_company_id)!;
    assertIncentiveAuthorization(params.actor, 'record_payment', companyId);
    if (calculation.x_state !== 'approved') {
      throw new Error('Payments can only settle approved calculations');
    }
    if (!(params.amount > 0)) {
      throw new Error('Payment amount must be positive');
    }
    const payments = await this.gateway.searchReadAll<{ x_amount: number }>(
      INCENTIVE_STUDIO_MODELS.payment,
      [['x_calculation_id', '=', params.calculationId], ['x_status', '=', 'recorded']],
      ['x_amount'],
    );
    const paid = payments.reduce((total, payment) => total + payment.x_amount, 0);
    if (paid + params.amount > calculation.x_final_incentive + 0.005) {
      throw new Error('Payment exceeds the remaining approved incentive');
    }
    const ids = await this.gateway.create<number[]>(INCENTIVE_STUDIO_MODELS.payment, [{
      x_name: params.reference,
      x_calculation_id: params.calculationId,
      x_company_id: companyId,
      x_currency_id: many2oneId(calculation.x_currency_id),
      x_amount: params.amount,
      x_payment_date: params.paymentDate,
      x_reference: params.reference,
      x_status: 'recorded',
      x_recorded_by_id: params.actor.userId,
      x_recorded_at: utcNowForOdoo(),
      x_notes: params.notes ?? false,
    }]);
    return ids[0];
  }
}

export type { PersistedSourceAudit };
