import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateIncentives } from '../src/lib/incentives/engine';
import { calculationBlockingSources } from '../src/lib/incentives/odoo/service';
import { fetchIncentiveSourceBundle } from '../src/lib/incentives/odoo/extraction';
import { defaultOdooGateway } from '../src/lib/incentives/odoo/gateway';
import { normalizeOdooIncentiveData } from '../src/lib/incentives/odoo/normalization';
import { StudioIncentiveRepository } from '../src/lib/incentives/odoo/studio-repository';
import {
  INCENTIVE_STUDIO_MODELS,
  inspectIncentiveStudioSchema,
} from '../src/lib/incentives/odoo/studio-schema';
import { assertPresetSchema } from '../src/lib/incentives/preset-schema';
import type { IncentiveEngineInput, IncentivePresetV1 } from '../src/lib/incentives/types';
import { odooCall } from '../src/lib/odoo/client';

type Many2one = false | [number, string];

interface EmployeeRecord {
  id: number;
  name: string;
  active: boolean;
  wage: number;
  user_id: Many2one;
  company_id: Many2one;
}

function loadEnvironment(): void {
  const path = resolve(process.cwd(), '.env.local');
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    process.env[key] ??= value;
  }
}

function many2oneId(value: Many2one): number | null {
  return value === false ? null : value[0];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function checksum(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function countByType<T extends { type: string }>(records: T[]): Record<string, number> {
  return Object.fromEntries(Object.entries(records.reduce<Record<string, number>>((counts, record) => {
    counts[record.type] = (counts[record.type] ?? 0) + 1;
    return counts;
  }, {})).sort());
}

async function runAudit() {
  const auditStarted = performance.now();
  const context = await odooCall<{ uid: number }>('res.users', 'context_get', {});
  const users = await defaultOdooGateway.searchRead<{ company_id: Many2one; company_ids: number[] }>(
    'res.users', [['id', '=', context.uid]], ['company_id', 'company_ids'], { limit: 1 },
  );
  const companyId = many2oneId(users[0].company_id);
  if (companyId === null) throw new Error('API user has no current company');

  const periodStart = '2025-08-01';
  const periodEnd = '2026-07-31';
  const representativeMonth = '2026-07';
  const preset = JSON.parse(readFileSync(
    resolve(process.cwd(), 'docs/incentives/initial-standard-preset.json'),
    'utf8',
  )) as IncentivePresetV1;
  assertPresetSchema(preset);
  const repository = new StudioIncentiveRepository(defaultOdooGateway);
  const extractionStarted = performance.now();
  const bundle = await fetchIncentiveSourceBundle({
    companyId,
    periodStart,
    periodEnd,
    gateway: defaultOdooGateway,
    attributionReader: repository,
  });
  const normalized = normalizeOdooIncentiveData(bundle);
  const extractionMilliseconds = performance.now() - extractionStarted;

  const employees = await defaultOdooGateway.searchReadAll<EmployeeRecord>(
    'hr.employee',
    [['company_id', '=', companyId]],
    ['id', 'name', 'active', 'wage', 'user_id', 'company_id'],
    { context: { active_test: false }, order: 'id' },
  );
  const activeEmployees = employees.filter((employee) => employee.active);
  const activeWageEmployees = activeEmployees.filter((employee) => employee.wage > 0);
  const salaryVersionsByEmployee = new Map<number, typeof bundle.salaryVersions>();
  for (const salary of bundle.salaryVersions) {
    const records = salaryVersionsByEmployee.get(salary.employeeId) ?? [];
    records.push(salary);
    salaryVersionsByEmployee.set(salary.employeeId, records);
  }
  const salaryConflicts = activeEmployees.flatMap((employee) => {
    const versions = salaryVersionsByEmployee.get(employee.id) ?? [];
    const dates = versions.reduce<Record<string, number>>((counts, version) => {
      counts[version.effectiveFrom] = (counts[version.effectiveFrom] ?? 0) + 1;
      return counts;
    }, {});
    return Object.entries(dates)
      .filter(([, count]) => count > 1)
      .map(([effectiveFrom, count]) => ({ employeeId: employee.id, effectiveFrom, count }));
  });

  const assignments = await defaultOdooGateway.searchReadAll<{
    id: number;
    x_employee_id: Many2one;
    x_preset_version_id: Many2one;
    x_company_id: Many2one;
    x_date_from: string;
    x_date_to: string | false;
    x_active: boolean;
  }>(
    INCENTIVE_STUDIO_MODELS.employeeAssignment,
    [['x_company_id', '=', companyId], ['x_active', '=', true]],
    ['id', 'x_employee_id', 'x_preset_version_id', 'x_company_id', 'x_date_from', 'x_date_to', 'x_active'],
    { order: 'x_employee_id,x_date_from,id' },
  );
  const monthStart = `${representativeMonth}-01`;
  const effectiveAssignments = activeWageEmployees.map((employee) => {
    const matches = assignments.filter((assignment) => (
      many2oneId(assignment.x_employee_id) === employee.id
      && assignment.x_date_from <= monthStart
      && (assignment.x_date_to === false || assignment.x_date_to >= monthStart)
    ));
    return { employeeId: employee.id, employee: employee.name, assignmentIds: matches.map((item) => item.id), count: matches.length };
  });

  const versions = await defaultOdooGateway.searchReadAll<{
    id: number;
    x_name: string;
    x_company_id: Many2one;
    x_status: string;
    x_rules_json: string;
    x_rules_checksum: string;
    x_locked: boolean;
  }>(
    INCENTIVE_STUDIO_MODELS.presetVersion,
    [['x_company_id', '=', companyId]],
    ['id', 'x_name', 'x_company_id', 'x_status', 'x_rules_json', 'x_rules_checksum', 'x_locked'],
  );
  const versionHealth = versions.map((version) => {
    let schemaValid = false;
    let checksumValid = false;
    try {
      const rules = JSON.parse(version.x_rules_json) as IncentivePresetV1;
      assertPresetSchema(rules);
      schemaValid = true;
      checksumValid = checksum(rules) === version.x_rules_checksum;
    } catch {
      schemaValid = false;
    }
    return {
      id: version.id,
      name: version.x_name,
      status: version.x_status,
      locked: version.x_locked,
      schemaValid,
      checksumValid,
    };
  });

  const calculationRecords = await defaultOdooGateway.searchReadAll<{
    id: number;
    x_company_id: Many2one;
    x_employee_id: Many2one;
    x_month: string;
    x_revision: number;
    x_supersedes_id: Many2one;
    x_state: string;
    x_preset_version_id: Many2one;
    x_engine_version: string;
    x_rules_checksum: string;
    x_input_checksum: string;
    x_rules_snapshot_json: string;
    x_input_snapshot_json: string;
    x_result_snapshot_json: string;
    x_salary_source_key: string;
    x_reviewed_by_id: Many2one;
    x_reviewed_at: string | false;
    x_approved_by_id: Many2one;
    x_approved_at: string | false;
  }>(
    INCENTIVE_STUDIO_MODELS.calculation,
    [['x_company_id', '=', companyId]],
    [
      'id', 'x_company_id', 'x_employee_id', 'x_month', 'x_revision', 'x_supersedes_id',
      'x_state', 'x_preset_version_id', 'x_engine_version', 'x_rules_checksum',
      'x_input_checksum', 'x_rules_snapshot_json', 'x_input_snapshot_json',
      'x_result_snapshot_json', 'x_salary_source_key', 'x_reviewed_by_id', 'x_reviewed_at',
      'x_approved_by_id', 'x_approved_at',
    ],
  );
  const approvedSnapshotHealth = calculationRecords
    .filter((record) => record.x_state === 'approved')
    .map((record) => ({
      id: record.id,
      employeeId: many2oneId(record.x_employee_id),
      month: record.x_month,
      revision: record.x_revision,
      supersedesId: many2oneId(record.x_supersedes_id),
      presetVersionId: many2oneId(record.x_preset_version_id),
      engineVersion: record.x_engine_version,
      rulesChecksumValid: checksum(JSON.parse(record.x_rules_snapshot_json)) === record.x_rules_checksum,
      inputChecksumValid: checksum(JSON.parse(record.x_input_snapshot_json)) === record.x_input_checksum,
      salarySourcePresent: Boolean(record.x_salary_source_key),
      reviewedBy: many2oneId(record.x_reviewed_by_id),
      reviewedAt: record.x_reviewed_at,
      approvedBy: many2oneId(record.x_approved_by_id),
      approvedAt: record.x_approved_at,
      inputSnapshotBytes: Buffer.byteLength(record.x_input_snapshot_json),
      resultSnapshotBytes: Buffer.byteLength(record.x_result_snapshot_json),
    }));

  const partnerIds = [...new Set(bundle.moves
    .filter((move) => ['out_invoice', 'out_refund'].includes(move.moveType))
    .map((move) => move.commercialPartnerId)
    .filter((id): id is number => id !== null))];
  const ownerByPartner = new Map(bundle.partnerOwners.map((owner) => [owner.partnerId, owner.currentOwnerUserId]));
  const activeEmployeeByUser = new Map(activeEmployees
    .map((employee) => [many2oneId(employee.user_id), employee.id] as const)
    .filter((entry): entry is [number, number] => entry[0] !== null));
  const ownerMissing = partnerIds.filter((partnerId) => ownerByPartner.get(partnerId) == null);
  const ownerUnmapped = partnerIds.filter((partnerId) => {
    const ownerUserId = ownerByPartner.get(partnerId);
    return ownerUserId != null && !activeEmployeeByUser.has(ownerUserId);
  });

  const historicalOwnerGaps = normalized.unresolvedSources.filter((source) => source.type === 'customer_owner');
  const moveById = new Map(bundle.moves.map((move) => [move.id, move]));
  const lineById = new Map(bundle.lines.map((line) => [line.id, line]));
  const expenseById = new Map(bundle.expenses.map((expense) => [expense.id, expense]));
  const unresolvedDate = (source: typeof normalized.unresolvedSources[number]) => {
    if (source.eventDate) return source.eventDate;
    if (source.sourceModel === 'account.move') return moveById.get(Number(source.sourceId))?.date;
    if (source.sourceModel === 'account.move.line') return lineById.get(Number(source.sourceId))?.date;
    if (source.sourceModel === 'hr.expense') return expenseById.get(Number(source.sourceId))?.date;
    return undefined;
  };
  const representativeUnresolved = normalized.unresolvedSources.filter((source) => (
    unresolvedDate(source)?.startsWith(representativeMonth) === true
  ));
  const sameDayKeys = new Set(bundle.partnerOwnerChanges.map((change) => `${change.partnerId}:${change.localChangeDate}`));
  const sameDayOwnerEvents = normalized.customerEvents.filter((event) => sameDayKeys.has(`${event.customerId}:${event.eventDate}`));

  const replayEmployees = [4, 5, 6]
    .map((employeeId) => activeWageEmployees.find((employee) => employee.id === employeeId))
    .filter((employee): employee is EmployeeRecord => employee !== undefined);
  const replays = replayEmployees.map((employee) => {
    const salaryHistory = normalized.salaryHistoryByEmployee[String(employee.id)] ?? [];
    const firstEffective = salaryHistory[0]?.effectiveFrom;
    const months = (normalized.monthsByEmployee[String(employee.id)] ?? [])
      .filter((month) => firstEffective && `${month.month}-01` >= firstEffective);
    const input: IncentiveEngineInput = {
      employeeId: employee.id,
      companyId,
      months,
      salaryHistory,
      customerEvents: normalized.customerEvents,
      adjustments: [],
      preset,
    };
    const firstStarted = performance.now();
    const first = calculateIncentives(input);
    const firstMilliseconds = performance.now() - firstStarted;
    const secondStarted = performance.now();
    const second = calculateIncentives(input);
    const secondMilliseconds = performance.now() - secondStarted;
    const result = first.months.find((month) => month.month === representativeMonth);
    if (!result) throw new Error(`No ${representativeMonth} result for employee ${employee.id}`);
    const representativeInput: IncentiveEngineInput = {
      ...input,
      months: input.months.filter((month) => month.month === representativeMonth),
    };
    const blocking = calculationBlockingSources(representativeInput, representativeUnresolved);
    return {
      employeeId: employee.id,
      employee: employee.name,
      preset: `${preset.name} rehearsal configuration`,
      salary: result.mainIncentive.salaryUsed,
      sales: result.accounting.netSales,
      cogs: result.accounting.cogs,
      grossMargin: result.accounting.grossMargin,
      transport: result.accounting.transport,
      loading: result.accounting.loading,
      employeeExpenses: result.accounting.employeeExpenses,
      commission: result.accounting.commission,
      actualBase: result.accounting.actualBase,
      structure: result.mainIncentive.structure,
      requiredThreshold: result.mainIncentive.requiredThreshold,
      carryIn: result.mainIncentive.carryIn,
      carryOut: result.mainIncentive.carryOut,
      newCustomerBonus: result.customerIncentive.newCustomerBonus,
      repeatCustomerBonus: result.customerIncentive.repeatCustomerBonus,
      adjustments: result.adjustmentTotal,
      finalIncentive: result.finalIncentive,
      unresolved: countByType(blocking),
      deterministic: canonicalJson(first) === canonicalJson(second),
      inputChecksum: checksum(input),
      resultChecksum: checksum(first),
      repeatedResultChecksum: checksum(second),
      firstMilliseconds,
      secondMilliseconds,
    };
  });

  const modelRecords = await defaultOdooGateway.searchReadAll<{ id: number; model: string }>(
    'ir.model', [['model', 'in', Object.values(INCENTIVE_STUDIO_MODELS)]], ['id', 'model'],
  );
  const modelIds = modelRecords.map((model) => model.id);
  const accessControls = await defaultOdooGateway.searchReadAll<Record<string, unknown>>(
    'ir.model.access', [['model_id', 'in', modelIds], ['active', '=', true]],
    ['id', 'name', 'model_id', 'group_id', 'perm_read', 'perm_write', 'perm_create', 'perm_unlink'],
    { order: 'name,id' },
  );
  const recordRules = await defaultOdooGateway.searchReadAll<Record<string, unknown>>(
    'ir.rule', [['model_id', 'in', modelIds], ['active', '=', true]],
    ['id', 'name', 'model_id', 'groups', 'domain_force', 'perm_read', 'perm_write', 'perm_create', 'perm_unlink'],
    { order: 'name,id' },
  );
  const roleGroups = await defaultOdooGateway.searchReadAll<{ id: number; name: string; user_ids: number[] }>(
    'res.groups', [['name', 'like', 'Sunlectric Incentives /']], ['id', 'name', 'user_ids'], { order: 'name' },
  );
  const payments = await defaultOdooGateway.searchReadAll<{
    id: number;
    x_calculation_id: Many2one;
    x_reference: string;
    x_amount: number;
    x_status: string;
  }>(
    INCENTIVE_STUDIO_MODELS.payment,
    [['x_company_id', '=', companyId]],
    ['id', 'x_calculation_id', 'x_reference', 'x_amount', 'x_status'],
  );
  const paymentKeys = payments.reduce<Record<string, number>>((counts, payment) => {
    const key = `${many2oneId(payment.x_calculation_id)}:${payment.x_reference}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    company: { currentCompanyId: companyId, allowedCompanyIds: users[0].company_ids },
    period: { historyStart: periodStart, representativeMonth, periodEnd },
    studio: {
      schema: await inspectIncentiveStudioSchema(defaultOdooGateway),
      accessControlCount: accessControls.length,
      accessControls,
      recordRuleCount: recordRules.length,
      recordRules,
      roleGroups,
    },
    employees: {
      activeCount: activeEmployees.length,
      activeWagePopulationCount: activeWageEmployees.length,
      missingUserMapping: activeWageEmployees.filter((employee) => many2oneId(employee.user_id) === null)
        .map((employee) => ({ id: employee.id, name: employee.name })),
      missingOrZeroWage: activeEmployees.filter((employee) => !(employee.wage > 0))
        .map((employee) => ({ id: employee.id, name: employee.name, wage: employee.wage })),
      missingAnySalaryHistory: activeWageEmployees.filter((employee) => (
        (salaryVersionsByEmployee.get(employee.id) ?? []).length === 0
      )).map((employee) => ({ id: employee.id, name: employee.name })),
      missingSalaryHistoryForRepresentativeMonth: activeWageEmployees.filter((employee) => (
        (salaryVersionsByEmployee.get(employee.id) ?? []).filter((version) => version.effectiveFrom <= monthStart).length === 0
      )).map((employee) => ({ id: employee.id, name: employee.name })),
      salaryConflicts,
    },
    customers: {
      commercialPartnerCount: partnerIds.length,
      missingCurrentOwnerCount: ownerMissing.length,
      unmappedCurrentOwnerCount: ownerUnmapped.length,
      historicalOwnerGapEventCount: historicalOwnerGaps.length,
      representativeMonthOwnerGapEventCount: representativeUnresolved
        .filter((source) => source.type === 'customer_owner').length,
      sameDayOwnerChangeEventCount: sameDayOwnerEvents.length,
      sameDayOwnerChangePendingCount: sameDayOwnerEvents.filter((event) => event.ownership.status === 'pending').length,
    },
    unresolved: {
      historicalCounts: countByType(normalized.unresolvedSources),
      representativeMonthCounts: countByType(representativeUnresolved),
      commissionLines: normalized.unresolvedSources
        .filter((source) => source.type === 'commission_assignment')
        .map((source) => source.sourceId),
      expenseSources: normalized.unresolvedSources
        .filter((source) => source.type === 'employee_expense' || source.type === 'expense_assignment_conflict')
        .map((source) => ({ type: source.type, sourceModel: source.sourceModel, sourceId: source.sourceId })),
    },
    assignments: {
      activeRecords: assignments,
      representativeMonth: effectiveAssignments,
      missingCount: effectiveAssignments.filter((assignment) => assignment.count === 0).length,
      overlapCount: effectiveAssignments.filter((assignment) => assignment.count > 1).length,
    },
    presets: {
      configuredVersions: versionHealth,
      activeVersionCount: versionHealth.filter((version) => version.status === 'active').length,
      invalidVersionCount: versionHealth.filter((version) => !version.schemaValid || !version.checksumValid).length,
    },
    replay: {
      configurationSource: 'docs/incentives/initial-standard-preset.json because no production assignments exist',
      employees: replays,
    },
    auditability: {
      calculations: approvedSnapshotHealth,
      allApprovedSnapshotsHealthy: approvedSnapshotHealth.every((record) => (
        record.rulesChecksumValid
        && record.inputChecksumValid
        && record.salarySourcePresent
        && record.reviewedBy !== null
        && record.reviewedAt !== false
        && record.approvedBy !== null
        && record.approvedAt !== false
      )),
    },
    payments: {
      recordCount: payments.length,
      duplicateCalculationReferenceKeys: Object.entries(paymentKeys)
        .filter(([, count]) => count > 1)
        .map(([key, count]) => ({ key, count })),
      idempotencyConstraintImplemented: false,
    },
    performance: {
      moveCount: bundle.moves.length,
      lineCount: bundle.lines.length,
      customerEventCount: normalized.customerEvents.length,
      extractionAndNormalizationMilliseconds: extractionMilliseconds,
      totalAuditMilliseconds: performance.now() - auditStarted,
    },
  };
}

loadEnvironment();
runAudit()
  .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
