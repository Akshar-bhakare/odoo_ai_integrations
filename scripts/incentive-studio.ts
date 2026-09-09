import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { odooCall } from '../src/lib/odoo/client';
import type { IncentiveEngineInput, IncentivePresetV1 } from '../src/lib/incentives/types';
import { defaultOdooGateway } from '../src/lib/incentives/odoo/gateway';
import { provisionIncentiveStudio } from '../src/lib/incentives/odoo/studio-provisioning';
import { inspectIncentiveStudioSchema } from '../src/lib/incentives/odoo/studio-schema';
import { INCENTIVE_STUDIO_MODELS } from '../src/lib/incentives/odoo/studio-schema';
import { StudioIncentiveRepository } from '../src/lib/incentives/odoo/studio-repository';

function loadEnvironment(): void {
  const path = resolve(process.cwd(), '.env.local');
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    process.env[key] ??= value;
  }
}

async function main(): Promise<void> {
  loadEnvironment();
  const command = process.argv[2] ?? 'inspect';
  if (command === 'inspect') {
    const status = await inspectIncentiveStudioSchema(defaultOdooGateway);
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return;
  }
  if (command === 'provision') {
    if (process.env.SUNLECTRIC_STUDIO_PROVISION !== 'CONFIRM') {
      throw new Error('Set SUNLECTRIC_STUDIO_PROVISION=CONFIRM for live Studio provisioning');
    }
    const context = await odooCall<{ uid: number }>('res.users', 'context_get', {});
    const result = await provisionIncentiveStudio(defaultOdooGateway, context.uid);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === 'smoke') {
    if (process.env.SUNLECTRIC_STUDIO_SMOKE !== 'CONFIRM') {
      throw new Error('Set SUNLECTRIC_STUDIO_SMOKE=CONFIRM for live persistence testing');
    }
    const result = await runSmokeTest();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

type Many2one = false | [number, string];

async function runSmokeTest() {
  const context = await odooCall<{ uid: number }>('res.users', 'context_get', {});
  const users = await defaultOdooGateway.searchRead<{
    id: number;
    company_id: Many2one;
    company_ids: number[];
  }>('res.users', [['id', '=', context.uid]], ['id', 'company_id', 'company_ids'], { limit: 1 });
  const user = users[0];
  const companyId = user.company_id ? user.company_id[0] : user.company_ids[0];
  const actor = {
    userId: user.id,
    companyIds: user.company_ids,
    roles: ['administrator'] as const,
  };
  const employees = await defaultOdooGateway.searchRead<{
    id: number;
    wage: number;
  }>('hr.employee', [['company_id', '=', companyId], ['active', '=', true]], ['id', 'wage'], {
    limit: 1,
    order: 'id',
  });
  if (employees.length === 0) {
    throw new Error(`No active employee exists in company ${companyId}`);
  }
  const employee = employees[0];
  const repository = new StudioIncentiveRepository(defaultOdooGateway);
  const token = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const code = `PHASE2_QA_${token}`;
  const basePreset = JSON.parse(
    readFileSync(resolve(process.cwd(), 'docs/incentives/initial-standard-preset.json'), 'utf8'),
  ) as IncentivePresetV1;
  const rules: IncentivePresetV1 = {
    ...basePreset,
    code,
    name: `[PHASE2 QA ${token}]`,
  };
  const draftRules: IncentivePresetV1 = {
    ...rules,
    performanceNotice: {
      ...rules.performanceNotice,
      consecutiveFailedMonths: rules.performanceNotice.consecutiveFailedMonths + 1,
    },
  };
  const presetId = await repository.createPreset({
    actor,
    name: rules.name,
    code,
    companyId,
  });
  const version1Id = await repository.createPresetVersion({
    actor,
    presetId,
    versionNumber: 1,
    rules,
  });
  await repository.updateDraftPresetVersion({ actor, versionId: version1Id, rules: draftRules });
  await repository.updateDraftPresetVersion({ actor, versionId: version1Id, rules });
  await repository.activatePresetVersion({ actor, versionId: version1Id });

  let repositoryMutationRejected = false;
  try {
    await repository.updateDraftPresetVersion({ actor, versionId: version1Id, rules: draftRules });
  } catch {
    repositoryMutationRejected = true;
  }
  let directMutationRejected = false;
  try {
    await defaultOdooGateway.write(INCENTIVE_STUDIO_MODELS.presetVersion, [version1Id], {
      x_rules_json: '{}',
    });
  } catch {
    directMutationRejected = true;
  }
  const version2Id = await repository.createPresetVersion({
    actor,
    presetId,
    versionNumber: 2,
    rules: draftRules,
  });

  const temporaryIds: Array<{ model: string; id: number }> = [];
  let assignmentOverlapRejected = false;
  let expenseDuplicateRejected = false;
  let commissionDuplicateRejected = false;
  let ownerDuplicateRejected = false;
  try {
    const assignmentId = await repository.assignEmployeePreset({
      actor,
      employeeId: employee.id,
      presetVersionId: version1Id,
      companyId,
      effectiveFrom: '2099-01-01',
      effectiveTo: '2099-01-31',
    });
    temporaryIds.push({ model: INCENTIVE_STUDIO_MODELS.employeeAssignment, id: assignmentId });
    try {
      await repository.assignEmployeePreset({
        actor,
        employeeId: employee.id,
        presetVersionId: version1Id,
        companyId,
        effectiveFrom: '2099-01-15',
        effectiveTo: '2099-02-15',
      });
    } catch {
      assignmentOverlapRejected = true;
    }

    const expenseLines = await defaultOdooGateway.searchRead<{
      move_id: Many2one;
      balance: number;
    }>('account.move.line', [
      ['company_id', '=', companyId],
      ['parent_state', '=', 'posted'],
      ['expense_id', '!=', false],
    ], ['move_id', 'balance'], { limit: 20, order: 'id desc' });
    for (const line of expenseLines) {
      if (!line.move_id) continue;
      const existing = await defaultOdooGateway.searchRead<{ id: number }>(
        INCENTIVE_STUDIO_MODELS.expenseAssignment,
        [['x_move_id', '=', line.move_id[0]], ['x_status', '!=', 'void']],
        ['id'],
        { limit: 1 },
      );
      if (existing.length > 0) continue;
      const id = await repository.assignExpense({
        actor,
        moveId: line.move_id[0],
        employeeId: employee.id,
        attributedAmount: line.balance,
        reason: `[PHASE2 QA ${token}] temporary expense attribution`,
      });
      temporaryIds.push({ model: INCENTIVE_STUDIO_MODELS.expenseAssignment, id });
      try {
        await repository.assignExpense({
          actor,
          moveId: line.move_id[0],
          employeeId: employee.id,
          attributedAmount: line.balance,
          reason: 'duplicate must fail',
        });
      } catch {
        expenseDuplicateRejected = true;
      }
      break;
    }

    const commissionAccounts = await defaultOdooGateway.searchRead<{ id: number }>(
      'account.account',
      [['code', '=', '211810'], ['company_ids', 'in', [companyId]]],
      ['id'],
      { limit: 1 },
    );
    if (commissionAccounts.length > 0) {
      const commissionLines = await defaultOdooGateway.searchRead<{ id: number }>(
        'account.move.line',
        [['account_id', '=', commissionAccounts[0].id], ['parent_state', '=', 'posted']],
        ['id'],
        { limit: 20, order: 'id desc' },
      );
      for (const line of commissionLines) {
        const existing = await defaultOdooGateway.searchRead<{ id: number }>(
          INCENTIVE_STUDIO_MODELS.commissionAssignment,
          [['x_move_line_id', '=', line.id], ['x_status', '!=', 'void']],
          ['id'],
          { limit: 1 },
        );
        if (existing.length > 0) continue;
        const id = await repository.assignCommission({
          actor,
          moveLineId: line.id,
          employeeId: employee.id,
          reason: `[PHASE2 QA ${token}] temporary commission attribution`,
        });
        temporaryIds.push({ model: INCENTIVE_STUDIO_MODELS.commissionAssignment, id });
        try {
          await repository.assignCommission({
            actor,
            moveLineId: line.id,
            employeeId: employee.id,
            reason: 'duplicate must fail',
          });
        } catch {
          commissionDuplicateRejected = true;
        }
        break;
      }
    }

    const eventKey = `phase2-qa:${token}`;
    const ownerId = await repository.resolveCustomerOwner({
      actor,
      eventKey,
      employeeId: employee.id,
      companyId,
      reason: `[PHASE2 QA ${token}] temporary owner resolution`,
    });
    temporaryIds.push({ model: INCENTIVE_STUDIO_MODELS.customerOwnerResolution, id: ownerId });
    try {
      await repository.resolveCustomerOwner({
        actor,
        eventKey,
        employeeId: employee.id,
        companyId,
        reason: 'duplicate must fail',
      });
    } catch {
      ownerDuplicateRejected = true;
    }
  } finally {
    for (const item of temporaryIds.reverse()) {
      await defaultOdooGateway.unlink(item.model, [item.id]);
    }
  }

  const salary = employee.wage || 20000;
  const input: IncentiveEngineInput = {
    employeeId: employee.id,
    companyId,
    preset: rules,
    months: [{
      month: '2099-01',
      accounting: {
        netSales: 500000,
        cogs: 100000,
        transport: 0,
        loading: 0,
        signedAccountingAdjustments: 0,
        employeeExpenses: 0,
        commission: 0,
      },
    }],
    salaryHistory: [{
      id: `hr.employee:${employee.id}:wage`,
      employeeId: employee.id,
      effectiveFrom: '2000-01-01',
      monthlyWage: salary,
    }],
    customerEvents: [],
    adjustments: [],
  };
  const invoices = await defaultOdooGateway.searchRead<{ id: number; name: string }>(
    'account.move',
    [['company_id', '=', companyId], ['state', '=', 'posted'], ['move_type', '=', 'out_invoice']],
    ['id', 'name'],
    { limit: 1, order: 'id desc' },
  );
  const source = invoices[0];
  const sources = source ? [{
    sourceModel: 'account.move',
    sourceRecordId: source.id,
    sourceKey: `account.move:${source.id}:invoice_sales`,
    category: 'invoice_sales' as const,
    signedAmount: 500000,
    snapshot: { id: source.id, name: source.name, purpose: 'PHASE2 QA relation verification' },
  }] : [];
  const calculationId = await repository.createDraftCalculation({
    actor,
    name: `[PHASE2 QA ${token}] Calculation`,
    presetVersionId: version1Id,
    revision: 1,
    input,
    sources,
    engineVersion: '1.0.0',
  });
  const adjustmentId = await repository.createAdjustment({
    actor,
    calculationId,
    operation: 'add',
    amount: 1000,
    reason: `[PHASE2 QA ${token}] adjustment verification`,
  });
  const approvalInput: IncentiveEngineInput = {
    ...input,
    adjustments: [{
      id: String(adjustmentId),
      employeeId: employee.id,
      month: '2099-01',
      operation: 'add',
      amount: 1000,
      reason: `[PHASE2 QA ${token}] adjustment verification`,
    }],
  };
  await repository.approveCalculation({
    actor,
    calculationId,
    loadFreshInput: async () => approvalInput,
    loadFreshSources: async () => sources,
  });
  let approvedMutationRejected = false;
  try {
    await defaultOdooGateway.write(INCENTIVE_STUDIO_MODELS.calculation, [calculationId], {
      x_final_incentive: 1,
    });
  } catch {
    approvedMutationRejected = true;
  }
  let approvedAdjustmentRejected = false;
  try {
    await repository.createAdjustment({
      actor,
      calculationId,
      operation: 'deduct',
      amount: 1,
      reason: 'approved adjustment must fail',
    });
  } catch {
    approvedAdjustmentRejected = true;
  }
  const beforePayment = await defaultOdooGateway.searchRead<Record<string, unknown>>(
    INCENTIVE_STUDIO_MODELS.calculation,
    [['id', '=', calculationId]],
    ['x_input_checksum', 'x_result_snapshot_json', 'x_carry_state_json', 'x_final_incentive'],
    { limit: 1 },
  );
  const paymentId = await repository.recordPayment({
    actor,
    calculationId,
    amount: Number(beforePayment[0].x_final_incentive),
    paymentDate: '2099-02-01',
    reference: `[PHASE2 QA ${token}] PAYMENT`,
  });
  const afterPayment = await defaultOdooGateway.searchRead<Record<string, unknown>>(
    INCENTIVE_STUDIO_MODELS.calculation,
    [['id', '=', calculationId]],
    ['x_input_checksum', 'x_result_snapshot_json', 'x_carry_state_json', 'x_final_incentive'],
    { limit: 1 },
  );
  let overpaymentRejected = false;
  try {
    await repository.recordPayment({
      actor,
      calculationId,
      amount: 1,
      paymentDate: '2099-02-01',
      reference: 'overpayment must fail',
    });
  } catch {
    overpaymentRejected = true;
  }
  const versions = await defaultOdooGateway.searchRead<Record<string, unknown>>(
    INCENTIVE_STUDIO_MODELS.presetVersion,
    [['id', 'in', [version1Id, version2Id]]],
    ['id', 'x_status', 'x_locked', 'x_rules_json', 'x_rules_checksum'],
  );
  const calculationSources = await defaultOdooGateway.searchRead<{ id: number }>(
    INCENTIVE_STUDIO_MODELS.calculationSource,
    [['x_calculation_id', '=', calculationId]],
    ['id'],
  );
  return {
    retainedQaRecords: { presetId, version1Id, version2Id, calculationId, adjustmentId, paymentId },
    employeeId: employee.id,
    checks: {
      schemaReady: (await repository.inspectSchema()).ready,
      draftUpdated: true,
      activeVersionLocked: versions.some((version) => version.id === version1Id && version.x_locked === true),
      newerDraftVersionCreated: versions.some((version) => version.id === version2Id && version.x_status === 'draft'),
      rulesJsonParses: versions.every((version) => {
        JSON.parse(String(version.x_rules_json));
        return true;
      }),
      repositoryMutationRejected,
      directMutationRejected,
      assignmentOverlapRejected,
      expenseDuplicateRejected,
      commissionDuplicateRejected,
      ownerDuplicateRejected,
      approvedMutationRejected,
      approvedAdjustmentRejected,
      sourceRelationCreated: calculationSources.length === sources.length,
      paymentDidNotAlterSnapshot: JSON.stringify(beforePayment) === JSON.stringify(afterPayment),
      overpaymentRejected,
    },
  };
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
