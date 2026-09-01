import 'server-only';
import { calculateIncentives } from '../engine';
import type {
  CalculationState,
  IncentiveEngineInput,
  IncentivePresetV1,
  MonthlyIncentiveResult,
  NormalizedAdjustment,
} from '../types';
import { assertPresetSchema } from '../preset-schema';
import type { AuthenticatedIncentiveActor } from '../../auth/types';
import {
  assertIncentiveReadAccess,
  assertReviewerScope,
} from '../../auth/incentive-access';
import { defaultOdooGateway, type OdooGateway } from '../odoo/gateway';
import { prepareIncentiveEngineInput, type PreparedIncentiveInput } from '../odoo/service';
import { paymentSummary } from './payment';
import { fetchIncentiveSourceBundle } from '../odoo/extraction';
import { normalizeOdooIncentiveData } from '../odoo/normalization';
import {
  StudioIncentiveRepository,
  type PersistedSourceAudit,
} from '../odoo/studio-repository';
import { INCENTIVE_STUDIO_MODELS } from '../odoo/studio-schema';
import { parseSnapshotJson } from '../snapshot-json';

type Many2one = false | [number, string];

interface AssignmentRecord {
  id: number;
  x_employee_id: Many2one;
  x_preset_version_id: Many2one;
  x_company_id: Many2one;
  x_date_from: string;
  x_date_to: string | false;
  x_active: boolean;
}

interface VersionRecord {
  id: number;
  x_preset_id: Many2one;
  x_company_id: Many2one;
  x_version_number: number;
  x_status: string;
  x_rules_json: string;
  x_rules_checksum: string;
  x_locked: boolean;
}

interface CalculationIdentityRecord {
  id: number;
  x_name: string;
  x_employee_id: Many2one;
  x_company_id: Many2one;
  x_month: string;
  x_preset_version_id: Many2one;
  x_revision: number;
  x_supersedes_id: Many2one;
  x_state: string;
  x_engine_version: string;
  x_result_snapshot_json: string;
}

interface AdjustmentRecord {
  id: number;
  x_employee_id: Many2one;
  x_month: string;
  x_operation: 'add' | 'deduct';
  x_amount: number;
  x_reason: string;
}

function many2oneId(value: Many2one): number | null {
  return value === false ? null : value[0];
}

function monthStart(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('Month must use YYYY-MM format');
  }
  return `${month}-01`;
}

function monthEnd(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function safeJson<T>(value: string, label: string): T {
  return parseSnapshotJson<T>(value, label);
}

function unresolvedForMonth(
  sources: PreparedIncentiveInput['unresolvedSources'],
  month: string,
): PreparedIncentiveInput['unresolvedSources'] {
  return sources.filter((source) => (
    source.type !== 'customer_owner' || source.eventDate?.slice(0, 7) === month
  ));
}

function customerEventMoveId(eventId: string): number | null {
  const value = Number(eventId.split(':').slice(-1)[0]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export class IncentiveApiService {
  constructor(
    private readonly gateway: OdooGateway = defaultOdooGateway,
    private readonly repository = new StudioIncentiveRepository(gateway),
  ) {}

  async listPresets(actor: AuthenticatedIncentiveActor) {
    assertIncentiveReadAccess(actor, 'presets', { companyId: actor.currentCompanyId });
    return this.gateway.searchReadAll<Record<string, unknown>>(
      INCENTIVE_STUDIO_MODELS.preset,
      [['x_company_id', '=', actor.currentCompanyId], ['x_active', '=', true]],
      ['id', 'x_name', 'x_code', 'x_company_id', 'x_current_version_id', 'x_active'],
      { order: 'x_name,id' },
    );
  }

  async listEmployees(actor: AuthenticatedIncentiveActor) {
    const companyWide = actor.roles.some((role) => ['reviewer', 'approver', 'administrator'].includes(role));
    if (!companyWide && actor.employeeId === null) {
      throw new Error('Authenticated user is not mapped to an employee');
    }
    const employeeId = companyWide ? undefined : actor.employeeId!;
    assertIncentiveReadAccess(actor, 'employee_data', {
      companyId: actor.currentCompanyId,
      employeeId,
    });
    const domain: unknown[] = [
      ['company_id', '=', actor.currentCompanyId],
      ['active', '=', true],
    ];
    if (employeeId !== undefined) domain.push(['id', '=', employeeId]);
    return this.gateway.searchReadAll<Record<string, unknown>>(
      'hr.employee',
      domain,
      ['id', 'name', 'company_id', 'user_id', 'active'],
      { order: 'name,id' },
    );
  }

  async listPresetVersions(actor: AuthenticatedIncentiveActor, presetId: number) {
    const preset = await this.one<{ x_company_id: Many2one }>(
      INCENTIVE_STUDIO_MODELS.preset,
      presetId,
      ['x_company_id'],
    );
    assertIncentiveReadAccess(actor, 'presets', { companyId: many2oneId(preset.x_company_id)! });
    return this.gateway.searchReadAll<Record<string, unknown>>(
      INCENTIVE_STUDIO_MODELS.presetVersion,
      [['x_preset_id', '=', presetId]],
      [
        'id', 'x_name', 'x_preset_id', 'x_company_id', 'x_version_number',
        'x_status', 'x_rules_checksum', 'x_locked', 'x_activated_by_id',
        'x_activated_at', 'create_uid', 'create_date',
      ],
      { order: 'x_version_number desc,id desc' },
    );
  }

  async getPresetVersion(actor: AuthenticatedIncentiveActor, versionId: number) {
    const version = await this.one<VersionRecord>(
      INCENTIVE_STUDIO_MODELS.presetVersion,
      versionId,
      [
        'x_preset_id', 'x_company_id', 'x_version_number', 'x_status',
        'x_rules_json', 'x_rules_checksum', 'x_locked', 'x_activated_by_id', 'x_activated_at',
      ],
    );
    assertIncentiveReadAccess(actor, 'presets', { companyId: many2oneId(version.x_company_id)! });
    return { ...version, rules: safeJson(version.x_rules_json, 'Preset version') };
  }

  async presetWorkspace(actor: AuthenticatedIncentiveActor) {
    const presets = await this.listPresets(actor);
    assertIncentiveReadAccess(actor, 'presets', { companyId: actor.currentCompanyId });
    const versions = await this.gateway.searchReadAll<Record<string, unknown> & { x_rules_json: string }>(
      INCENTIVE_STUDIO_MODELS.presetVersion,
      [['x_company_id', '=', actor.currentCompanyId]],
      [
        'id', 'x_name', 'x_preset_id', 'x_company_id', 'x_version_number',
        'x_status', 'x_rules_json', 'x_rules_checksum', 'x_locked', 'x_activated_by_id',
        'x_activated_at', 'create_uid', 'create_date',
      ],
      { order: 'x_preset_id,x_version_number desc,id desc' },
    );
    return {
      presets,
      versions: versions.map((version) => ({
        ...version,
        rules: safeJson<IncentivePresetV1>(version.x_rules_json, `Preset version ${version.id}`),
      })),
    };
  }

  async assignmentWorkspace(actor: AuthenticatedIncentiveActor) {
    const assignments = await this.listAssignments(actor);
    const employees = await this.listEmployees(actor);
    assertIncentiveReadAccess(actor, 'presets', { companyId: actor.currentCompanyId });
    const versions = await this.gateway.searchReadAll<Record<string, unknown>>(
      INCENTIVE_STUDIO_MODELS.presetVersion,
      [['x_company_id', '=', actor.currentCompanyId]],
      [
        'id', 'x_name', 'x_preset_id', 'x_company_id', 'x_version_number',
        'x_status', 'x_rules_checksum', 'x_locked', 'x_activated_by_id',
        'x_activated_at', 'create_uid', 'create_date',
      ],
      { order: 'x_preset_id,x_version_number desc,id desc' },
    );
    return { assignments, employees, versions };
  }

  async listAssignments(actor: AuthenticatedIncentiveActor) {
    const domain: unknown[] = [['x_company_id', '=', actor.currentCompanyId], ['x_active', '=', true]];
    if (!actor.roles.some((role) => ['reviewer', 'approver', 'administrator'].includes(role))) {
      if (actor.employeeId === null) {
        throw new Error('Authenticated user is not mapped to an employee');
      }
      domain.push(['x_employee_id', '=', actor.employeeId]);
    }
    assertIncentiveReadAccess(actor, 'assignments', {
      companyId: actor.currentCompanyId,
      employeeId: actor.employeeId,
    });
    return this.gateway.searchReadAll<Record<string, unknown>>(
      INCENTIVE_STUDIO_MODELS.employeeAssignment,
      domain,
      [
        'id', 'x_name', 'x_employee_id', 'x_preset_version_id', 'x_company_id',
        'x_date_from', 'x_date_to', 'x_active',
      ],
      { order: 'x_employee_id,x_date_from desc,id desc' },
    );
  }

  async employeeData(actor: AuthenticatedIncentiveActor, employeeId: number) {
    assertIncentiveReadAccess(actor, 'employee_data', {
      companyId: actor.currentCompanyId,
      employeeId,
    });
    const calculations = await this.listCalculationRecords(actor, employeeId);
    return {
      employeeId,
      calculations,
      customerIncentives: calculations.map((calculation) => {
        const result = safeJson<Record<string, unknown>>(
          String(calculation.x_result_snapshot_json),
          `Calculation ${calculation.id}`,
        );
        return { calculationId: calculation.id, month: calculation.x_month, customerIncentive: result.customerIncentive };
      }),
    };
  }

  async listCalculations(actor: AuthenticatedIncentiveActor, employeeId?: number) {
    const canReadCompanyScope = actor.roles.some((role) => (
      ['reviewer', 'approver', 'administrator', 'payment_recorder'].includes(role)
    ));
    const targetEmployeeId = employeeId ?? (canReadCompanyScope ? undefined : actor.employeeId);
    if (targetEmployeeId == null && !canReadCompanyScope) {
      throw new Error('Employee ID is required for this actor');
    }
    assertIncentiveReadAccess(actor, 'calculations', {
      companyId: actor.currentCompanyId,
      employeeId: targetEmployeeId,
    });
    return this.listCalculationRecords(actor, targetEmployeeId ?? undefined);
  }

  async calculation(actor: AuthenticatedIncentiveActor, calculationId: number) {
    const record = await this.one<Record<string, unknown> & {
      x_employee_id: Many2one;
      x_company_id: Many2one;
    }>(
      INCENTIVE_STUDIO_MODELS.calculation,
      calculationId,
      [
        'x_name', 'x_employee_id', 'x_company_id', 'x_currency_id', 'x_month',
        'x_period_start', 'x_period_end', 'x_preset_version_id', 'x_revision',
        'x_supersedes_id', 'x_state', 'x_engine_version', 'x_rules_checksum',
        'x_input_checksum', 'x_rules_snapshot_json', 'x_input_snapshot_json',
        'x_result_snapshot_json', 'x_threshold_state_json', 'x_slab_state_json',
        'x_carry_state_json', 'x_salary_source_key', 'x_salary_used', 'x_actual_base',
        'x_raw_incentive', 'x_adjustment_total', 'x_final_incentive',
        'x_reviewed_by_id', 'x_reviewed_at', 'x_approved_by_id', 'x_approved_at',
        'x_payment_state', 'x_paid_amount',
      ],
    );
    assertIncentiveReadAccess(actor, 'calculations', {
      companyId: many2oneId(record.x_company_id)!,
      employeeId: many2oneId(record.x_employee_id),
    });
    const input = safeJson<IncentiveEngineInput>(String(record.x_input_snapshot_json), 'Calculation input');
    const result = safeJson<MonthlyIncentiveResult>(String(record.x_result_snapshot_json), 'Calculation result');
    const customerIds = [...new Set(input.customerEvents.map((event) => event.customerId))];
    const customers = customerIds.length === 0 ? [] : await this.gateway.searchReadAll<Record<string, unknown>>(
      'res.partner',
      [['id', 'in', customerIds]],
      ['id', 'name'],
      { order: 'name,id' },
    );
    const adjustments = await this.gateway.searchReadAll<Record<string, unknown>>(
      INCENTIVE_STUDIO_MODELS.adjustment,
      [['x_calculation_id', '=', calculationId]],
      [
        'id', 'x_operation', 'x_amount', 'x_reason', 'x_notes',
        'create_uid', 'create_date',
      ],
      { order: 'create_date,id' },
    );
    const payments = await this.gateway.searchReadAll<Record<string, unknown>>(
      INCENTIVE_STUDIO_MODELS.payment,
      [['x_calculation_id', '=', calculationId]],
      [
        'id', 'x_amount', 'x_payment_date', 'x_reference', 'x_status',
        'x_recorded_by_id', 'x_recorded_at', 'x_notes',
      ],
      { order: 'x_payment_date,id' },
    );
    const settlement = paymentSummary(
      Number(record.x_final_incentive),
      payments as Array<{ x_amount: number }>,
    );
    return {
      ...record,
      x_paid_amount: settlement.paidAmount,
      x_payment_state: settlement.paymentState,
      rules: safeJson<IncentivePresetV1>(String(record.x_rules_snapshot_json), 'Calculation rules'),
      input,
      result,
      thresholdState: safeJson<Record<string, unknown>>(String(record.x_threshold_state_json), 'Threshold state'),
      slabState: safeJson<Record<string, unknown>>(String(record.x_slab_state_json), 'Slab state'),
      carryState: safeJson<Record<string, unknown>>(String(record.x_carry_state_json), 'Carry state'),
      customers,
      adjustments,
      payments,
    };
  }

  async calculationSources(actor: AuthenticatedIncentiveActor, calculationId: number) {
    await this.calculation(actor, calculationId);
    return this.listCalculationSources(calculationId);
  }

  async calculationWorkbench(actor: AuthenticatedIncentiveActor, calculationId: number) {
    const calculation = await this.calculation(actor, calculationId);
    const missingInvoiceMoveIds = [...new Set(calculation.input.customerEvents.flatMap((event) => {
      if (event.invoiceNumbers?.length) return [];
      const moveId = customerEventMoveId(event.id);
      return moveId === null ? [] : [moveId];
    }))];
    if (missingInvoiceMoveIds.length > 0) {
      const invoiceMoves = await this.gateway.searchReadAll<{ id: number; name: string }>(
        'account.move',
        [['id', 'in', missingInvoiceMoveIds]],
        ['id', 'name'],
      );
      const invoiceNameByMoveId = new Map(invoiceMoves.map((move) => [move.id, move.name]));
      calculation.input.customerEvents = calculation.input.customerEvents.map((event) => {
        if (event.invoiceNumbers?.length) return event;
        const moveId = customerEventMoveId(event.id);
        const invoiceName = moveId === null ? undefined : invoiceNameByMoveId.get(moveId);
        return invoiceName ? { ...event, invoiceNumbers: [invoiceName] } : event;
      });
    }
    const sources = await this.listCalculationSources(calculationId);
    const employees = await this.listEmployees(actor);
    return { calculation, sources, employees };
  }

  private listCalculationSources(calculationId: number) {
    return this.gateway.searchReadAll<Record<string, unknown>>(
      INCENTIVE_STUDIO_MODELS.calculationSource,
      [['x_calculation_id', '=', calculationId]],
      [
        'id', 'x_name', 'x_source_model', 'x_source_record_id', 'x_source_key',
        'x_source_category', 'x_signed_amount', 'x_source_snapshot_json',
      ],
      { order: 'x_source_category,x_source_record_id,id' },
    );
  }

  async unresolved(actor: AuthenticatedIncentiveActor, month: string) {
    assertIncentiveReadAccess(actor, 'unresolved', { companyId: actor.currentCompanyId });
    const bundle = await fetchIncentiveSourceBundle({
      companyId: actor.currentCompanyId,
      periodStart: monthStart(month),
      periodEnd: monthEnd(month),
      gateway: this.gateway,
      attributionReader: this.repository,
    });
    return unresolvedForMonth(normalizeOdooIncentiveData(bundle).unresolvedSources, month);
  }

  async unresolvedDetails(
    actor: AuthenticatedIncentiveActor,
    month: string,
    types: string[],
  ) {
    assertIncentiveReadAccess(actor, 'unresolved', { companyId: actor.currentCompanyId });
    const bundle = await fetchIncentiveSourceBundle({
      companyId: actor.currentCompanyId,
      periodStart: monthStart(month),
      periodEnd: monthEnd(month),
      gateway: this.gateway,
      attributionReader: this.repository,
    });
    const normalized = normalizeOdooIncentiveData(bundle);
    const unresolved = [...new Map(
      unresolvedForMonth(normalized.unresolvedSources, month)
        .filter((source) => types.includes(source.type))
        .map((source) => [`${source.type}:${source.sourceModel}:${source.sourceId}:${source.message}`, source]),
    ).values()];
    const moveById = new Map(bundle.moves.map((move) => [move.id, move]));
    const lineById = new Map(bundle.lines.map((line) => [line.id, line]));
    const accountById = new Map(bundle.accounts.map((account) => [account.id, account]));
    const expenseById = new Map(bundle.expenses.map((expense) => [expense.id, expense]));
    const partnerIds = unresolved
      .filter((source) => source.sourceModel === 'res.partner' && typeof source.sourceId === 'number')
      .map((source) => Number(source.sourceId));
    const partners = partnerIds.length === 0 ? [] : await this.gateway.searchReadAll<{ id: number; name: string }>(
      'res.partner',
      [['id', 'in', [...new Set(partnerIds)]]],
      ['id', 'name'],
    );
    const partnerById = new Map(partners.map((partner) => [partner.id, partner.name]));
    return unresolved.map((source) => {
      if (source.type === 'commission_assignment') {
        const line = lineById.get(Number(source.sourceId));
        const move = line ? moveById.get(line.moveId) : undefined;
        const account = line ? accountById.get(line.accountId) : undefined;
        return {
          ...source,
          moveId: line?.moveId ?? null,
          date: line?.date ?? null,
          amount: line?.balance ?? null,
          description: move?.name ?? source.message,
          account: account ? `${account.code} ${account.name}` : null,
        };
      }
      if (source.type === 'employee_expense' || source.type === 'expense_assignment_conflict') {
        const expenseId = source.sourceModel === 'hr.expense' ? Number(source.sourceId) : null;
        const expenseLines = expenseId === null
          ? bundle.lines.filter((line) => line.moveId === Number(source.sourceId))
          : bundle.lines.filter((line) => line.expenseId === expenseId);
        const moveId = expenseLines[0]?.moveId ?? (source.sourceModel === 'account.move' ? Number(source.sourceId) : null);
        const move = moveId === null ? undefined : moveById.get(moveId);
        return {
          ...source,
          moveId,
          date: expenseId === null ? move?.date ?? null : expenseById.get(expenseId)?.date ?? null,
          amount: expenseLines.reduce((total, line) => total + line.balance, 0),
          description: move?.name ?? source.message,
        };
      }
      const eventKey = source.eventKey ?? source.message.match(/event (.+) has no event-date/)?.[1] ?? null;
      const event = eventKey ? normalized.customerEvents.find((item) => item.id === eventKey) : undefined;
      return {
        ...source,
        eventKey,
        customer: partnerById.get(Number(source.sourceId)) ?? `Customer ${source.sourceId}`,
        eventDate: event?.eventDate ?? null,
        billing: event?.billing ?? null,
        grossMargin: event?.grossMargin ?? null,
        kind: event?.kind ?? null,
        qualification: 'pending_owner',
      };
    });
  }

  async createDraftCalculation(params: {
    actor: AuthenticatedIncentiveActor;
    employeeId: number;
    month: string;
  }) {
    assertReviewerScope(params.actor);
    const existing = await this.gateway.searchReadAll<{
      id: number;
      x_revision: number;
      x_state: string;
    }>(
      INCENTIVE_STUDIO_MODELS.calculation,
      [
        ['x_company_id', '=', params.actor.currentCompanyId],
        ['x_employee_id', '=', params.employeeId],
        ['x_month', '=', monthStart(params.month)],
      ],
      ['id', 'x_revision', 'x_state'],
      { order: 'x_revision desc,id desc' },
    );
    const openCalculation = existing.find((record) => ['draft', 'review'].includes(record.x_state));
    if (openCalculation) {
      const refreshed = openCalculation.x_state === 'draft'
        ? await this.recalculate(params.actor, openCalculation.id)
        : { unresolvedSources: [] };
      return {
        calculationId: openCalculation.id,
        reused: true,
        unresolvedSources: refreshed.unresolvedSources,
      };
    }
    const prepared = await this.prepareAuthoritative(params.actor, params.employeeId, params.month);
    const latest = existing[0];
    const calculationId = await this.repository.createDraftCalculation({
      actor: params.actor,
      name: `Employee ${params.employeeId} / ${params.month} / Revision ${(latest?.x_revision ?? 0) + 1}`,
      presetVersionId: prepared.presetVersionId,
      revision: (latest?.x_revision ?? 0) + 1,
      supersedesId: latest?.x_state === 'approved' ? latest.id : null,
      input: prepared.data.engineInput,
      sources: prepared.sources,
      engineVersion: '1.0.0',
    });
    return {
      calculationId,
      unresolvedSources: prepared.data.unresolvedSources,
      preview: calculateIncentives(prepared.data.engineInput),
    };
  }

  async recalculate(actor: AuthenticatedIncentiveActor, calculationId: number) {
    const identity = await this.calculationIdentity(calculationId);
    const employeeId = many2oneId(identity.x_employee_id)!;
    const prepared = await this.prepareAuthoritative(actor, employeeId, identity.x_month.slice(0, 7), calculationId);
    if (prepared.presetVersionId !== many2oneId(identity.x_preset_version_id)) {
      throw new Error('Effective assignment no longer matches the calculation preset version');
    }
    await this.repository.recalculateDraft({
      actor,
      calculationId,
      input: prepared.data.engineInput,
      sources: prepared.sources,
    });
    return { unresolvedSources: prepared.data.unresolvedSources };
  }

  async submit(actor: AuthenticatedIncentiveActor, calculationId: number) {
    await this.repository.submitCalculationForReview({ actor, calculationId });
  }

  async approve(actor: AuthenticatedIncentiveActor, calculationId: number) {
    const identity = await this.calculationIdentity(calculationId);
    const employeeId = many2oneId(identity.x_employee_id)!;
    const month = identity.x_month.slice(0, 7);
    const verification = await this.prepareAuthoritative(actor, employeeId, month, calculationId);
    if (verification.data.unresolvedSources.length > 0) {
      throw new Error('Unresolved accounting or ownership sources block approval');
    }
    if (verification.presetVersionId !== many2oneId(identity.x_preset_version_id)) {
      throw new Error('Effective assignment no longer matches the calculation preset version');
    }
    await this.repository.approveCalculation({
      actor,
      calculationId,
      loadFreshInput: async () => verification.data.engineInput,
      loadFreshSources: async () => verification.sources,
    });
    return this.calculation(actor, calculationId);
  }

  private async prepareAuthoritative(
    actor: AuthenticatedIncentiveActor,
    employeeId: number,
    month: string,
    calculationId?: number,
  ): Promise<{
    presetVersionId: number;
    data: PreparedIncentiveInput;
    sources: PersistedSourceAudit[];
  }> {
    assertReviewerScope(actor);
    const start = monthStart(month);
    const assignments = await this.gateway.searchReadAll<AssignmentRecord>(
      INCENTIVE_STUDIO_MODELS.employeeAssignment,
      [
        ['x_employee_id', '=', employeeId],
        ['x_company_id', '=', actor.currentCompanyId],
        ['x_active', '=', true],
        ['x_date_from', '<=', start],
        '|',
        ['x_date_to', '=', false],
        ['x_date_to', '>=', start],
      ],
      ['id', 'x_employee_id', 'x_preset_version_id', 'x_company_id', 'x_date_from', 'x_date_to', 'x_active'],
    );
    if (assignments.length !== 1) {
      throw new Error(`Expected exactly one effective employee assignment, found ${assignments.length}`);
    }
    const presetVersionId = many2oneId(assignments[0].x_preset_version_id)!;
    const version = await this.one<VersionRecord>(
      INCENTIVE_STUDIO_MODELS.presetVersion,
      presetVersionId,
      ['x_preset_id', 'x_company_id', 'x_version_number', 'x_status', 'x_rules_json', 'x_rules_checksum', 'x_locked'],
    );
    if (version.x_status !== 'active' || !version.x_locked) {
      throw new Error('Effective preset version is not active and locked');
    }
    const preset = safeJson<IncentivePresetV1>(version.x_rules_json, 'Preset version');
    assertPresetSchema(preset);
    const adjustments = calculationId ? await this.adjustments(calculationId, employeeId, month) : [];
    const initialState = await this.initialState(employeeId, actor.currentCompanyId, month);
    const data = await prepareIncentiveEngineInput({
      companyId: actor.currentCompanyId,
      employeeId,
      periodStart: start,
      periodEnd: monthEnd(month),
      preset,
      adjustments,
      initialState,
      gateway: this.gateway,
      attributionReader: this.repository,
    });
    return {
      presetVersionId,
      data,
      sources: await this.persistedSources(data),
    };
  }

  private async persistedSources(data: PreparedIncentiveInput): Promise<PersistedSourceAudit[]> {
    const salesMoveIds = data.sourceAudit
      .filter((source) => source.category === 'sales' && source.sourceModel === 'account.move')
      .map((source) => source.sourceId);
    const moves = salesMoveIds.length === 0
      ? []
      : await this.gateway.searchReadAll<{
          id: number;
          move_type: string;
          name: string;
          date: string;
          partner_id: false | [number, string];
        }>(
          'account.move',
          [['id', 'in', salesMoveIds]],
          ['id', 'move_type', 'name', 'date', 'partner_id'],
        );
    const moveById = new Map(moves.map((move) => [move.id, move]));
    const accounting = data.sourceAudit.map((source): PersistedSourceAudit => {
      const move = moveById.get(source.moveId);
      const category = source.category === 'sales'
        ? move?.move_type === 'out_refund' ? 'credit_note_sales' : 'invoice_sales'
        : source.category;
      return {
        sourceModel: source.sourceModel,
        sourceRecordId: source.sourceId,
        sourceKey: `${source.sourceModel}:${source.sourceId}:${category}`,
        category,
        signedAmount: source.signedAmount,
        snapshot: {
          ...source,
          moveName: move?.name,
          moveType: move?.move_type,
          moveDate: move?.date,
          partnerId: Array.isArray(move?.partner_id) ? move.partner_id[0] : undefined,
          partnerName: Array.isArray(move?.partner_id) ? move.partner_id[1] : undefined,
        },
      };
    });
    const calculationMonths = new Set(data.engineInput.months.map((item) => item.month));
    const customerEvents = data.engineInput.customerEvents.filter((event) => (
      calculationMonths.has(event.eventDate.slice(0, 7))
      && event.ownership.status === 'resolved'
      && event.ownership.employeeId === data.engineInput.employeeId
    ));
    const customers = customerEvents.map((event): PersistedSourceAudit => ({
      sourceModel: 'res.partner',
      sourceRecordId: event.customerId,
      sourceKey: event.id,
      category: event.kind === 'new_customer' ? 'new_customer' : 'repeat_customer',
      signedAmount: event.billing,
      snapshot: event,
    }));
    return [...accounting, ...customers];
  }

  private async adjustments(calculationId: number, employeeId: number, month: string): Promise<NormalizedAdjustment[]> {
    const records = await this.gateway.searchReadAll<AdjustmentRecord>(
      INCENTIVE_STUDIO_MODELS.adjustment,
      [['x_calculation_id', '=', calculationId]],
      ['id', 'x_employee_id', 'x_month', 'x_operation', 'x_amount', 'x_reason'],
    );
    return records.map((record) => ({
      id: String(record.id),
      employeeId: many2oneId(record.x_employee_id)!,
      month,
      operation: record.x_operation,
      amount: record.x_amount,
      reason: record.x_reason,
    })).filter((adjustment) => adjustment.employeeId === employeeId);
  }

  private async initialState(employeeId: number, companyId: number, month: string): Promise<CalculationState | undefined> {
    const records = await this.gateway.searchRead<{
      x_result_snapshot_json: string;
    }>(
      INCENTIVE_STUDIO_MODELS.calculation,
      [
        ['x_employee_id', '=', employeeId],
        ['x_company_id', '=', companyId],
        ['x_state', '=', 'approved'],
        ['x_month', '<', monthStart(month)],
      ],
      ['x_result_snapshot_json'],
      { limit: 1, order: 'x_month desc,x_revision desc,id desc' },
    );
    if (!records[0]) return undefined;
    const result = safeJson<{ stateAfter?: CalculationState }>(records[0].x_result_snapshot_json, 'Prior calculation');
    return result.stateAfter;
  }

  private async calculationIdentity(id: number): Promise<CalculationIdentityRecord> {
    return this.one<CalculationIdentityRecord>(
      INCENTIVE_STUDIO_MODELS.calculation,
      id,
      [
        'x_name', 'x_employee_id', 'x_company_id', 'x_month', 'x_preset_version_id',
        'x_revision', 'x_supersedes_id', 'x_state', 'x_engine_version', 'x_result_snapshot_json',
      ],
    );
  }

  private async listCalculationRecords(
    actor: AuthenticatedIncentiveActor,
    employeeId?: number,
  ): Promise<Record<string, unknown>[]> {
    const domain: unknown[] = [['x_company_id', '=', actor.currentCompanyId]];
    if (employeeId !== undefined) domain.push(['x_employee_id', '=', employeeId]);
    const calculations = await this.gateway.searchReadAll<Record<string, unknown>>(
      INCENTIVE_STUDIO_MODELS.calculation,
      domain,
      [
        'id', 'x_name', 'x_employee_id', 'x_month', 'x_revision', 'x_state',
        'x_preset_version_id', 'x_salary_used', 'x_actual_base', 'x_raw_incentive',
        'x_adjustment_total', 'x_final_incentive', 'x_result_snapshot_json',
        'x_payment_state', 'x_paid_amount', 'x_approved_at',
      ],
      { order: 'x_month desc,x_revision desc,id desc' },
    );
    if (calculations.length === 0) return calculations;
    const payments = await this.gateway.searchReadAll<{
      x_calculation_id: Many2one;
      x_amount: number;
    }>(
      INCENTIVE_STUDIO_MODELS.payment,
      [['x_calculation_id', 'in', calculations.map((calculation) => calculation.id)], ['x_status', '=', 'recorded']],
      ['x_calculation_id', 'x_amount'],
    );
    const paymentsByCalculation = new Map<number, Array<{ x_amount: number }>>();
    for (const payment of payments) {
      const calculationId = many2oneId(payment.x_calculation_id);
      if (calculationId === null) continue;
      const records = paymentsByCalculation.get(calculationId) ?? [];
      records.push(payment);
      paymentsByCalculation.set(calculationId, records);
    }
    return calculations.map((calculation) => {
      const settlement = paymentSummary(
        Number(calculation.x_final_incentive),
        paymentsByCalculation.get(Number(calculation.id)) ?? [],
      );
      return {
        ...calculation,
        x_paid_amount: settlement.paidAmount,
        x_payment_state: settlement.paymentState,
      } as Record<string, unknown>;
    });
  }

  private async one<T>(model: string, id: number, fields: string[]): Promise<T> {
    const records = await this.gateway.searchRead<T>(model, [['id', '=', id]], fields, { limit: 1 });
    if (records.length !== 1) throw new Error(`${model} record ${id} was not found`);
    return records[0];
  }
}
