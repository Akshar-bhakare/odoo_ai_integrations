import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultOdooGateway } from '../src/lib/incentives/odoo/gateway';
import { INCENTIVE_ROLE_GROUPS } from '../src/lib/incentives/odoo/studio-provisioning';
import { INCENTIVE_STUDIO_MODELS } from '../src/lib/incentives/odoo/studio-schema';
import { StudioIncentiveRepository } from '../src/lib/incentives/odoo/studio-repository';
import { fetchIncentiveSourceBundle } from '../src/lib/incentives/odoo/extraction';
import { normalizeOdooIncentiveData } from '../src/lib/incentives/odoo/normalization';
import { prepareIncentiveEngineInput } from '../src/lib/incentives/odoo/service';
import { odooCall } from '../src/lib/odoo/client';
import { calculateIncentives } from '../src/lib/incentives/engine';
import type { IncentivePresetV1 } from '../src/lib/incentives/types';
import { calculationDashboardRow } from '../src/lib/incentives/ui/view-model';
import type { CalculationSummaryRecord } from '../src/lib/incentives/ui/types';
import { SignJWT } from 'jose';

type Many2one = false | [number, string];

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

function id(value: Many2one): number | null {
  return value === false ? null : value[0];
}

async function testSession(baseUrl: string, userId: number) {
  const csrfToken = crypto.randomUUID();
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET is unavailable for test session');
  const token = await new SignJWT({ csrf: csrfToken })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(secret));
  return { csrfToken, cookie: `sunlectric_session=${token}` };
}

function accountingEffect(params: {
  moveId: number;
  lines: Awaited<ReturnType<typeof fetchIncentiveSourceBundle>>['lines'];
  accounts: Awaited<ReturnType<typeof fetchIncentiveSourceBundle>>['accounts'];
}) {
  const accountById = new Map(params.accounts.map((account) => [account.id, account]));
  const moveLines = params.lines.filter((line) => line.moveId === params.moveId);
  const sales = moveLines.reduce((total, line) => (
    accountById.get(line.accountId)?.accountType === 'income' ? total - line.balance : total
  ), 0);
  const cogs = moveLines.reduce((total, line) => (
    accountById.get(line.accountId)?.accountType === 'expense_direct_cost' ? total + line.balance : total
  ), 0);
  return {
    sales,
    cogs,
    grossMargin: sales - cogs,
    lines: moveLines.flatMap((line) => {
      const account = accountById.get(line.accountId);
      if (!account || !['income', 'expense_direct_cost'].includes(account.accountType)) return [];
      return [{
        lineId: line.id,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.accountType,
        debit: line.debit,
        credit: line.credit,
        balance: line.balance,
      }];
    }),
  };
}

async function inspect() {
  const context = await odooCall<{ uid: number }>('res.users', 'context_get', {});
  const users = await defaultOdooGateway.searchRead<{
    id: number;
    name: string;
    login: string;
    active: boolean;
    company_id: Many2one;
    company_ids: number[];
    group_ids: number[];
  }>('res.users', [['id', '=', context.uid]], ['id', 'name', 'login', 'active', 'company_id', 'company_ids', 'group_ids'], { limit: 1 });
  const user = users[0];
  if (!user) throw new Error(`API-key Odoo user ${context.uid} was not found`);
  const companyId = id(user.company_id) ?? user.company_ids[0];
  const roleGroups = await defaultOdooGateway.searchReadAll<{
    id: number;
    name: string;
    user_ids: number[];
  }>('res.groups', [['name', 'in', Object.values(INCENTIVE_ROLE_GROUPS)]], ['id', 'name', 'user_ids'], { order: 'name' });
  const roleUserIds = [...new Set(roleGroups.flatMap((group) => group.user_ids))];
  const roleUsers = roleUserIds.length === 0 ? [] : await defaultOdooGateway.searchReadAll<{
    id: number;
    name: string;
    active: boolean;
    company_ids: number[];
  }>('res.users', [['id', 'in', roleUserIds]], ['id', 'name', 'active', 'company_ids'], { order: 'name' });

  const employees = await defaultOdooGateway.searchReadAll<{
    id: number;
    name: string;
    wage: number;
    user_id: Many2one;
    active: boolean;
  }>('hr.employee', [['company_id', '=', companyId], ['active', '=', true]], ['id', 'name', 'wage', 'user_id', 'active'], { order: 'name' });
  const actorGroups = roleGroups.filter((group) => user.group_ids.includes(group.id));
  const actorEmployees = employees.filter((employee) => id(employee.user_id) === user.id);
  const wageEmployees = employees.filter((employee) => employee.wage === 20000);
  const repository = new StudioIncentiveRepository(defaultOdooGateway);
  const bundle = await fetchIncentiveSourceBundle({
    companyId,
    periodStart: '2025-08-01',
    periodEnd: '2026-08-31',
    gateway: defaultOdooGateway,
    attributionReader: repository,
  });
  const normalized = normalizeOdooIncentiveData(bundle);
  const employeeSummaries = wageEmployees.map((employee) => {
    const months = normalized.monthsByEmployee[String(employee.id)] ?? [];
    return {
      id: employee.id,
      name: employee.name,
      userId: id(employee.user_id),
      salaryVersionCount: (normalized.salaryHistoryByEmployee[String(employee.id)] ?? []).length,
      months: months.map((month) => {
        const accounting = month.accounting;
        const grossMargin = accounting.netSales - accounting.cogs;
        const adjustedGrossMargin = grossMargin - accounting.transport - accounting.loading + accounting.signedAccountingAdjustments;
        return {
          month: month.month,
          netSales: accounting.netSales,
          cogs: accounting.cogs,
          grossMargin,
          transport: accounting.transport,
          loading: accounting.loading,
          employeeExpenses: accounting.employeeExpenses,
          commission: accounting.commission,
          actualBase: adjustedGrossMargin - accounting.employeeExpenses - accounting.commission,
        };
      }).filter((month) => Object.entries(month).some(([key, value]) => key !== 'month' && value !== 0)),
    };
  });
  const standardPreset = JSON.parse(
    readFileSync(resolve(process.cwd(), 'docs/incentives/initial-standard-preset.json'), 'utf8'),
  ) as IncentivePresetV1;
  const engineRuns = wageEmployees.flatMap((employee) => {
    const salaryHistory = normalized.salaryHistoryByEmployee[String(employee.id)] ?? [];
    const firstEffective = salaryHistory[0]?.effectiveFrom;
    if (!firstEffective) return [];
    const months = (normalized.monthsByEmployee[String(employee.id)] ?? [])
      .filter((month) => `${month.month}-01` >= firstEffective);
    if (months.length === 0) return [];
    const engineResult = calculateIncentives({
      employeeId: employee.id,
      companyId,
      months,
      salaryHistory,
      customerEvents: normalized.customerEvents,
      adjustments: [],
      preset: standardPreset,
    });
    return [{ employee, salaryHistory, results: engineResult.months }];
  });
  const engineCandidates = engineRuns.flatMap(({ employee, salaryHistory, results }) => {
    if (!results.some((month) => month.accounting.employeeExpenses > 0)) return [];
    const result = results.find((month) => month.accounting.employeeExpenses > 0 && month.mainIncentive.thresholdMet)
      ?? results.find((month) => month.accounting.employeeExpenses > 0);
    return result ? [{ employee, salaryHistory, result }] : [];
  });
  const customerBonusFixtures = engineRuns.flatMap(({ employee, results }) => results.flatMap((result) => {
    const customer = result.customerIncentive;
    if (customer.newCustomerBonus === 0 && customer.repeatCustomerBonus === 0) return [];
    const paidEventIds = new Set([
      ...customer.paidNewCustomerEventIds,
      ...customer.paidRepeatCustomerEventIds,
    ]);
    return [{
      employee: { id: employee.id, name: employee.name },
      month: result.month,
      newCustomerBonus: customer.newCustomerBonus,
      repeatCustomerBonus: customer.repeatCustomerBonus,
      paidNewCustomerEventIds: customer.paidNewCustomerEventIds,
      paidRepeatCustomerEventIds: customer.paidRepeatCustomerEventIds,
      paidEvents: normalized.customerEvents.filter((event) => paidEventIds.has(event.id)),
    }];
  })).slice(0, 20);
  const fixture = engineCandidates[0] ?? null;
  const testEmployee = fixture?.employee ?? null;
  const fixtureResult = fixture?.result ?? null;
  const fixtureUiRow = testEmployee && fixtureResult ? calculationDashboardRow({
    id: 0,
    x_name: 'Phase 5 live fixture preview',
    x_employee_id: [testEmployee.id, testEmployee.name],
    x_month: `${fixtureResult.month}-01`,
    x_revision: 0,
    x_state: 'preview',
    x_preset_version_id: [0, 'Sunlectric Standard Sales Incentive v1'],
    x_salary_used: fixtureResult.mainIncentive.salaryUsed,
    x_actual_base: fixtureResult.accounting.actualBase,
    x_raw_incentive: fixtureResult.calculatedIncentive,
    x_adjustment_total: fixtureResult.adjustmentTotal,
    x_final_incentive: fixtureResult.finalIncentive,
    x_result_snapshot_json: JSON.stringify(fixtureResult),
    x_payment_state: 'unpaid',
    x_paid_amount: 0,
    x_approved_at: false,
  } satisfies CalculationSummaryRecord) : null;
  const fixturePrepared = fixture && fixtureResult ? await prepareIncentiveEngineInput({
    companyId,
    employeeId: fixture.employee.id,
    periodStart: `${fixtureResult.month}-01`,
    periodEnd: `${fixtureResult.month}-${new Date(Date.UTC(
      Number(fixtureResult.month.slice(0, 4)),
      Number(fixtureResult.month.slice(5, 7)),
      0,
    )).getUTCDate()}`,
    preset: standardPreset,
    gateway: defaultOdooGateway,
    attributionReader: repository,
  }) : null;

  const refunds = bundle.moves.filter((move) => move.moveType === 'out_refund');
  const refund = refunds.find((move) => move.reversedEntryId !== null) ?? refunds[0];
  const original = refund?.reversedEntryId ? bundle.moves.find((move) => move.id === refund.reversedEntryId) : undefined;
  const creditNote = refund ? {
    refund: { id: refund.id, name: refund.name, date: refund.date, ...accountingEffect({ moveId: refund.id, lines: bundle.lines, accounts: bundle.accounts }) },
    original: original ? { id: original.id, name: original.name, date: original.date, ...accountingEffect({ moveId: original.id, lines: bundle.lines, accounts: bundle.accounts }) } : null,
  } : null;
  const moveById = new Map(bundle.moves.map((move) => [move.id, move]));
  const accountById = new Map(bundle.accounts.map((account) => [account.id, account]));
  const commissionAssignmentByLineId = new Map(
    bundle.commissionAssignments
      .filter((assignment) => assignment.status !== 'void')
      .map((assignment) => [assignment.moveLineId, assignment]),
  );
  const commissionLines = bundle.lines.flatMap((line) => {
    const account = accountById.get(line.accountId);
    if (account?.code !== '211810') return [];
    const move = moveById.get(line.moveId);
    const assignment = commissionAssignmentByLineId.get(line.id);
    return [{
      lineId: line.id,
      moveId: line.moveId,
      moveName: move?.name ?? null,
      date: line.date,
      accountCode: account.code,
      accountName: account.name,
      debit: line.debit,
      credit: line.credit,
      balance: line.balance,
      assignmentStatus: assignment?.status ?? 'missing',
      employeeId: assignment?.employeeId ?? null,
    }];
  });

  const presets = await defaultOdooGateway.searchReadAll<Record<string, unknown>>(
    INCENTIVE_STUDIO_MODELS.preset,
    [['x_company_id', '=', companyId]],
    ['id', 'x_name', 'x_code', 'x_current_version_id', 'x_active'],
  );
  const assignments = await defaultOdooGateway.searchReadAll<Record<string, unknown>>(
    INCENTIVE_STUDIO_MODELS.employeeAssignment,
    [['x_company_id', '=', companyId]],
    ['id', 'x_employee_id', 'x_preset_version_id', 'x_date_from', 'x_date_to', 'x_active'],
  );
  const calculations = await defaultOdooGateway.searchReadAll<Record<string, unknown>>(
    INCENTIVE_STUDIO_MODELS.calculation,
    [['x_company_id', '=', companyId]],
    ['id', 'x_name', 'x_employee_id', 'x_month', 'x_state', 'x_final_incentive', 'x_payment_state'],
  );

  return {
    generatedAt: new Date().toISOString(),
    authentication: {
      apiKeyOwnerUserId: context.uid,
      apiKeyOwnerLogin: user.login,
      actor: {
        userId: user.id,
        name: user.name,
        currentCompanyId: companyId,
        companyIds: user.company_ids,
        employeeId: actorEmployees.length === 1 ? actorEmployees[0].id : null,
        employeeMapping: actorEmployees.length === 0 ? 'missing' : actorEmployees.length === 1 ? 'mapped' : 'ambiguous',
        roleGroups: actorGroups.map((group) => group.name),
      },
    },
    roleGroups: roleGroups.map((group) => ({
      id: group.id,
      name: group.name,
      userIds: group.user_ids,
      users: roleUsers.filter((roleUser) => group.user_ids.includes(roleUser.id)),
    })),
    wageEmployees: employeeSummaries,
    accounting: {
      period: ['2025-08-01', '2026-08-31'],
      moveCount: bundle.moves.length,
      lineCount: bundle.lines.length,
      sourceAuditCount: normalized.sourceAudit.length,
      unresolvedCounts: Object.fromEntries(Object.entries(normalized.unresolvedSources.reduce<Record<string, number>>((counts, source) => {
        counts[source.type] = (counts[source.type] ?? 0) + 1;
        return counts;
      }, {})).sort()),
      customerEventCount: normalized.customerEvents.length,
      pendingCustomerOwnerCount: normalized.customerEvents.filter((event) => event.ownership.status === 'pending').length,
      commissionLines,
    },
    creditNote,
    customerBonusFixtures,
    calculationFixture: testEmployee && fixtureResult ? {
      employee: { id: testEmployee.id, name: testEmployee.name, wage: testEmployee.wage },
      salaryHistory: fixture?.salaryHistory,
      month: fixtureResult.month,
      accounting: fixtureResult.accounting,
      mainIncentive: fixtureResult.mainIncentive,
      customerIncentive: fixtureResult.customerIncentive,
      calculatedIncentive: fixtureResult.calculatedIncentive,
      adjustmentTotal: fixtureResult.adjustmentTotal,
      finalIncentive: fixtureResult.finalIncentive,
      resolutionIssueCount: fixtureResult.resolutionIssues.length,
      approvalBlockingSourceCounts: Object.fromEntries(Object.entries((fixturePrepared?.unresolvedSources ?? []).reduce<Record<string, number>>((counts, source) => {
        counts[source.type] = (counts[source.type] ?? 0) + 1;
        return counts;
      }, {})).sort()),
      uiDashboardRow: fixtureUiRow,
    } : null,
    persistence: {
      presets,
      assignments,
      calculations,
    },
  };
}

async function httpSmoke(baseUrl: string) {
  const context = await odooCall<{ uid: number }>('res.users', 'context_get', {});
  const users = await defaultOdooGateway.searchRead<{ login: string }>(
    'res.users',
    [['id', '=', context.uid]],
    ['login'],
    { limit: 1 },
  );
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ login: users[0].login, password: process.env.ODOO_API_KEY }),
  });
  const loginBody = await loginResponse.json() as { actor?: unknown; csrfToken?: string; error?: string };
  let csrfToken = loginBody.csrfToken;
  let cookie = loginResponse.headers.get('set-cookie')?.split(';')[0];
  let authenticationMethod = 'odoo_credential_login';
  if (!loginResponse.ok || !csrfToken || !cookie) {
    authenticationMethod = 'server_side_test_session_for_api_key_owner';
    ({ csrfToken, cookie } = await testSession(baseUrl, context.uid));
  }
  const get = async (path: string) => {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie } });
    return { path, status: response.status, body: await response.json() };
  };
  const session = await get('/api/auth/session');
  const reads = [];
  for (const path of [
    '/api/incentives/presets',
    '/api/incentives/assignments',
    '/api/incentives/calculations',
    '/api/incentives/unresolved/commissions?month=2026-08',
    '/api/incentives/unresolved/customer-owners?month=2026-08',
    '/api/odoo/orders',
  ]) {
    reads.push(await get(path));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
  }
  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: baseUrl, 'x-csrf-token': csrfToken },
  });
  return {
    credentialLoginStatus: loginResponse.status,
    credentialLoginError: loginResponse.ok ? null : loginBody.error ?? 'Login failed',
    authenticationMethod,
    loginActor: loginBody.actor,
    sessionStatus: session.status,
    session: session.body,
    protectedReads: reads.map((item) => ({
      path: item.path,
      status: item.status,
      count: Array.isArray(item.body) ? item.body.length : undefined,
      error: item.status >= 400 && typeof item.body === 'object' && item.body !== null && 'error' in item.body
        ? String((item.body as { error: unknown }).error)
        : undefined,
    })),
    logoutStatus: logout.status,
  };
}

async function workflow(baseUrl: string) {
  const context = await odooCall<{ uid: number }>('res.users', 'context_get', {});
  const users = await defaultOdooGateway.searchRead<{
    id: number;
    company_id: Many2one;
  }>('res.users', [['id', '=', context.uid]], ['id', 'company_id'], { limit: 1 });
  const companyId = id(users[0].company_id);
  if (!companyId) throw new Error('API-key owner has no current company');
  const employees = await defaultOdooGateway.searchReadAll<{
    id: number;
    name: string;
    wage: number;
    user_id: Many2one;
  }>('hr.employee', [['company_id', '=', companyId], ['active', '=', true], ['wage', '=', 20000]], ['id', 'name', 'wage', 'user_id'], { order: 'id' });
  const employee = employees.find((candidate) => id(candidate.user_id) === context.uid) ?? employees[0];
  if (!employee) throw new Error('No active ₹20,000 employee is available');
  const versions = await defaultOdooGateway.searchReadAll<{
    id: number;
    x_name: string;
    x_rules_json: string;
    x_status: string;
    x_locked: boolean;
  }>(INCENTIVE_STUDIO_MODELS.presetVersion, [
    ['x_company_id', '=', companyId],
    ['x_status', '=', 'active'],
    ['x_locked', '=', true],
  ], ['id', 'x_name', 'x_rules_json', 'x_status', 'x_locked'], { order: 'id' });
  const version = versions.find((candidate) => {
    const rules = JSON.parse(candidate.x_rules_json) as IncentivePresetV1;
    return rules.mainIncentive.structure === 'flat'
      && rules.mainIncentive.flat.threshold.salaryMultiplier === 6
      && rules.mainIncentive.flat.rate === 0.1
      && rules.mainIncentive.flat.carryForwardEnabled
      && rules.mainIncentive.flat.payoutBasis === 'entire_eligible_base'
      && rules.mainIncentive.flat.previousBasePayout === 'include_previous_unpaid_base';
  });
  if (!version) throw new Error('No active locked Standard-equivalent preset version is available');

  const month = '2099-02';
  const existingAssignments = await defaultOdooGateway.searchReadAll<{ id: number }>(
    INCENTIVE_STUDIO_MODELS.employeeAssignment,
    [['x_company_id', '=', companyId], ['x_employee_id', '=', employee.id], ['x_date_from', '<=', '2099-02-28'], '|', ['x_date_to', '=', false], ['x_date_to', '>=', '2099-02-01']],
    ['id'],
  );
  const existingCalculations = await defaultOdooGateway.searchReadAll<{ id: number }>(
    INCENTIVE_STUDIO_MODELS.calculation,
    [['x_company_id', '=', companyId], ['x_employee_id', '=', employee.id], ['x_month', '=', '2099-02-01']],
    ['id'],
  );
  if (existingAssignments.length || existingCalculations.length) {
    throw new Error('Phase 5 workflow period already contains records; refusing to overwrite or duplicate them');
  }

  const { csrfToken, cookie } = await testSession(baseUrl, context.uid);
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        Origin: baseUrl,
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const responseBody = await response.json() as Record<string, unknown>;
    return { status: response.status, body: responseBody };
  };
  const expectSuccess = (label: string, response: Awaited<ReturnType<typeof request>>) => {
    if (response.status >= 400) throw new Error(`${label} failed (${response.status}): ${JSON.stringify(response.body)}`);
    return response.body;
  };

  const assignment = await request('/api/incentives/assignments', 'POST', {
    employeeId: employee.id,
    presetVersionId: version.id,
    effectiveFrom: '2099-02-01',
    effectiveTo: '2099-02-28',
  });
  const assignmentBody = expectSuccess('Assignment', assignment);
  const overlap = await request('/api/incentives/assignments', 'POST', {
    employeeId: employee.id,
    presetVersionId: version.id,
    effectiveFrom: '2099-02-15',
    effectiveTo: '2099-03-15',
  });
  const draft = await request('/api/incentives/calculations', 'POST', { employeeId: employee.id, month });
  const draftBody = expectSuccess('Draft calculation', draft);
  const calculationId = Number(draftBody.calculationId);
  expectSuccess('Positive adjustment', await request(`/api/incentives/calculations/${calculationId}/adjustments`, 'POST', {
    operation: 'add', amount: 1000, reason: '[PHASE5 QA] positive adjustment',
  }));
  expectSuccess('Negative adjustment', await request(`/api/incentives/calculations/${calculationId}/adjustments`, 'POST', {
    operation: 'deduct', amount: 250, reason: '[PHASE5 QA] negative adjustment',
  }));
  expectSuccess('Recalculation', await request(`/api/incentives/calculations/${calculationId}/recalculate`, 'POST'));
  const beforeApproval = expectSuccess('Draft detail', await request(`/api/incentives/calculations/${calculationId}`));
  expectSuccess('Submit', await request(`/api/incentives/calculations/${calculationId}/submit`, 'POST'));
  const approved = expectSuccess('Approval', await request(`/api/incentives/calculations/${calculationId}/approve`, 'POST'));
  const immutableAdjustment = await request(`/api/incentives/calculations/${calculationId}/adjustments`, 'POST', {
    operation: 'add', amount: 1, reason: 'approved mutation must fail',
  });
  let directMutationRejected = false;
  try {
    await defaultOdooGateway.write(INCENTIVE_STUDIO_MODELS.calculation, [calculationId], { x_final_incentive: 1 });
  } catch {
    directMutationRejected = true;
  }
  const payment = expectSuccess('Payment', await request(`/api/incentives/calculations/${calculationId}/payments`, 'POST', {
    amount: 750,
    paymentDate: '2099-03-01',
    reference: '[PHASE5 QA] PAYMENT',
    mode: 'Phase 5 verification',
  }));
  const afterPayment = expectSuccess('Paid detail', await request(`/api/incentives/calculations/${calculationId}`));
  const overpayment = await request(`/api/incentives/calculations/${calculationId}/payments`, 'POST', {
    amount: 1,
    paymentDate: '2099-03-01',
    reference: 'overpayment must fail',
    mode: 'Phase 5 verification',
  });

  return {
    employee,
    presetVersion: { id: version.id, name: version.x_name },
    retainedQaRecords: {
      assignmentId: Number(assignmentBody.assignmentId),
      calculationId,
      paymentId: Number(payment.paymentId),
    },
    checks: {
      overlapRejected: overlap.status >= 400,
      unresolvedAtDraft: Array.isArray(draftBody.unresolvedSources) ? draftBody.unresolvedSources.length : null,
      rawIncentive: beforeApproval.x_raw_incentive,
      adjustmentTotal: beforeApproval.x_adjustment_total,
      finalIncentive: beforeApproval.x_final_incentive,
      approvedState: approved.x_state,
      approvedAdjustmentRejected: immutableAdjustment.status >= 400,
      directMutationRejected,
      paidAmount: afterPayment.x_paid_amount,
      paymentState: afterPayment.x_payment_state,
      paymentDidNotAlterInputChecksum: approved.x_input_checksum === afterPayment.x_input_checksum,
      paymentDidNotAlterResultSnapshot: approved.x_result_snapshot_json === afterPayment.x_result_snapshot_json,
      paymentDidNotAlterCarryState: approved.x_carry_state_json === afterPayment.x_carry_state_json,
      overpaymentRejected: overpayment.status >= 400,
    },
  };
}

async function workflowStatus(baseUrl: string) {
  const context = await odooCall<{ uid: number }>('res.users', 'context_get', {});
  const calculations = await defaultOdooGateway.searchReadAll<{
    id: number;
    x_employee_id: Many2one;
    x_state: string;
    x_final_incentive: number;
    x_paid_amount: number;
    x_payment_state: string;
    x_input_checksum: string;
    x_result_snapshot_json: string;
    x_carry_state_json: string;
  }>(INCENTIVE_STUDIO_MODELS.calculation, [['x_month', '=', '2099-02-01']], [
    'id', 'x_employee_id', 'x_state', 'x_final_incentive', 'x_paid_amount', 'x_payment_state',
    'x_input_checksum', 'x_result_snapshot_json', 'x_carry_state_json',
  ], { order: 'id desc' });
  const calculation = calculations[0];
  if (!calculation) throw new Error('The Phase 5 QA calculation was not found');
  const payments = await defaultOdooGateway.searchReadAll<{
    id: number;
    x_amount: number;
    x_status: string;
  }>(INCENTIVE_STUDIO_MODELS.payment, [['x_calculation_id', '=', calculation.id]], ['id', 'x_amount', 'x_status'], { order: 'id' });
  const assignments = await defaultOdooGateway.searchReadAll<{ id: number }>(
    INCENTIVE_STUDIO_MODELS.employeeAssignment,
    [['x_employee_id', '=', id(calculation.x_employee_id)], ['x_date_from', '<=', '2099-02-01'], '|', ['x_date_to', '=', false], ['x_date_to', '>=', '2099-02-01']],
    ['id'],
  );
  const { csrfToken, cookie } = await testSession(baseUrl, context.uid);
  const request = async (path: string, body?: unknown) => {
    const method = body === undefined ? 'GET' : 'POST';
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        Origin: baseUrl,
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const detail = await request(`/api/incentives/calculations/${calculation.id}`);
  if (detail.status !== 200) throw new Error(`Calculation detail failed: ${JSON.stringify(detail.body)}`);
  const missingCsrf = await fetch(`${baseUrl}/api/incentives/calculations/${calculation.id}/recalculate`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: baseUrl },
  });
  const immutableAdjustment = await request(`/api/incentives/calculations/${calculation.id}/adjustments`, {
    operation: 'add', amount: 1, reason: 'approved mutation must fail',
  });
  const overpayment = await request(`/api/incentives/calculations/${calculation.id}/payments`, {
    amount: 1,
    paymentDate: '2099-03-01',
    reference: 'overpayment must fail',
    mode: 'Phase 5 verification',
  });
  let directMutationRejected = false;
  try {
    await defaultOdooGateway.write(INCENTIVE_STUDIO_MODELS.calculation, [calculation.id], { x_final_incentive: 1 });
  } catch {
    directMutationRejected = true;
  }
  return {
    calculationId: calculation.id,
    employeeId: id(calculation.x_employee_id),
    assignmentIds: assignments.map((assignment) => assignment.id),
    paymentRows: payments,
    storedCalculationSettlementCache: {
      paidAmount: calculation.x_paid_amount,
      paymentState: calculation.x_payment_state,
    },
    apiDerivedSettlement: {
      paidAmount: detail.body.x_paid_amount,
      paymentState: detail.body.x_payment_state,
    },
    checks: {
      approved: calculation.x_state === 'approved',
      rawIncentive: detail.body.x_raw_incentive,
      adjustmentTotal: detail.body.x_adjustment_total,
      finalIncentive: detail.body.x_final_incentive,
      exactlyOneEffectiveAssignment: assignments.length === 1,
      paymentRecorded: payments.length === 1 && payments[0].x_status === 'recorded',
      settlementDerivedWithoutCalculationMutation: calculation.x_paid_amount === 0
        && detail.body.x_paid_amount === payments[0]?.x_amount,
      approvedAdjustmentRejected: immutableAdjustment.status >= 400,
      missingCsrfRejected: missingCsrf.status === 403,
      directMutationRejected,
      overpaymentRejected: overpayment.status >= 400,
    },
  };
}

async function attributionWorkflow(baseUrl: string) {
  const context = await odooCall<{ uid: number }>('res.users', 'context_get', {});
  const users = await defaultOdooGateway.searchRead<{ company_id: Many2one }>(
    'res.users', [['id', '=', context.uid]], ['company_id'], { limit: 1 },
  );
  const companyId = id(users[0].company_id);
  if (!companyId) throw new Error('API-key owner has no current company');
  const employees = await defaultOdooGateway.searchReadAll<{ id: number; name: string; wage: number }>(
    'hr.employee', [['company_id', '=', companyId], ['active', '=', true], ['wage', '=', 20000]], ['id', 'name', 'wage'], { order: 'id' },
  );
  const employee = employees.find((candidate) => candidate.id === 4) ?? employees[0];
  if (!employee) throw new Error('No ₹20,000 employee is available');
  const accounts = await defaultOdooGateway.searchReadAll<{ id: number; code: string; account_type: string }>(
    'account.account', [['company_ids', 'in', [companyId]], ['account_type', 'in', ['expense', 'expense_direct_cost']]], ['id', 'code', 'account_type'],
  );
  const expenseAccountIds = accounts.filter((account) => account.code !== '211810').map((account) => account.id);
  const candidateLines = await defaultOdooGateway.searchRead<{
    id: number;
    move_id: Many2one;
    date: string;
    balance: number;
    expense_id: Many2one;
  }>('account.move.line', [
    ['company_id', '=', companyId], ['parent_state', '=', 'posted'], ['date', '>=', '2025-12-01'], ['date', '<=', '2025-12-31'],
    ['account_id', 'in', expenseAccountIds], ['expense_id', '=', false], ['balance', '>', 0],
  ], ['id', 'move_id', 'date', 'balance', 'expense_id'], { order: 'id', limit: 100 });
  const existingExpenseAssignments = await defaultOdooGateway.searchReadAll<{ x_move_id: Many2one }>(
    INCENTIVE_STUDIO_MODELS.expenseAssignment, [['x_status', '!=', 'void']], ['x_move_id'],
  );
  const assignedMoveIds = new Set(existingExpenseAssignments.map((assignment) => id(assignment.x_move_id)));
  const expenseLine = candidateLines.find((line) => {
    const moveId = id(line.move_id);
    return moveId !== null && !assignedMoveIds.has(moveId);
  });
  if (!expenseLine) throw new Error('No safe posted December expense move is available for temporary attribution');
  const expenseMoveId = id(expenseLine.move_id)!;
  const moves = await defaultOdooGateway.searchRead<{
    id: number;
    name: string;
    currency_id: Many2one;
  }>('account.move', [['id', '=', expenseMoveId]], ['id', 'name', 'currency_id'], { limit: 1 });
  const move = moves[0];
  const company = await defaultOdooGateway.searchRead<{ currency_id: Many2one }>(
    'res.company', [['id', '=', companyId]], ['currency_id'], { limit: 1 },
  );
  const currencyId = id(move.currency_id) ?? id(company[0].currency_id);
  if (!currencyId) throw new Error('Expense move has no currency');
  const commissionLines = await defaultOdooGateway.searchReadAll<{
    id: number;
    move_id: Many2one;
    date: string;
    balance: number;
  }>('account.move.line', [
    ['company_id', '=', companyId], ['parent_state', '=', 'posted'], ['date', '>=', '2026-01-01'], ['date', '<=', '2026-01-31'],
    ['account_id.code', '=', '211810'],
  ], ['id', 'move_id', 'date', 'balance'], { order: 'id' });
  const existingCommissionAssignments = await defaultOdooGateway.searchReadAll<{ x_move_line_id: Many2one }>(
    INCENTIVE_STUDIO_MODELS.commissionAssignment, [['x_status', '!=', 'void']], ['x_move_line_id'],
  );
  const assignedCommissionIds = new Set(existingCommissionAssignments.map((assignment) => id(assignment.x_move_line_id)));
  const commissionLine = commissionLines.find((line) => !assignedCommissionIds.has(line.id));
  if (!commissionLine) throw new Error('No unresolved January commission line is available');

  const repository = new StudioIncentiveRepository(defaultOdooGateway);
  const { csrfToken, cookie } = await testSession(baseUrl, context.uid);
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: baseUrl, 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const accountingFor = async (month: string) => {
    const endDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    const bundle = await fetchIncentiveSourceBundle({
      companyId,
      periodStart: `${month}-01`,
      periodEnd: `${month}-${endDay}`,
      gateway: defaultOdooGateway,
      attributionReader: repository,
    });
    const normalized = normalizeOdooIncentiveData(bundle);
    return {
      accounting: normalized.monthsByEmployee[String(employee.id)]?.[0]?.accounting,
      unresolved: normalized.unresolvedSources,
    };
  };
  let expenseAssignmentId: number | null = null;
  let commissionAssignmentId: number | null = null;
  try {
    const ids = await defaultOdooGateway.create<number[]>(INCENTIVE_STUDIO_MODELS.expenseAssignment, [{
      x_name: `[PHASE5 QA] unresolved expense ${expenseMoveId}`,
      x_move_id: expenseMoveId,
      x_employee_id: false,
      x_company_id: companyId,
      x_currency_id: currencyId,
      x_attributed_amount: expenseLine.balance,
      x_status: 'unresolved',
      x_reason: '[PHASE5 QA] temporary unresolved-workbench verification',
      x_notes: 'Incentive attribution only; accounting ownership unchanged',
    }]);
    expenseAssignmentId = ids[0];
    const expenseBefore = await accountingFor('2025-12');
    const expenseResponse = await post('/api/incentives/attributions/expenses', {
      moveId: expenseMoveId,
      employeeId: employee.id,
      attributedAmount: expenseLine.balance,
      reason: '[PHASE5 QA] assign exactly one employee',
    });
    if (expenseResponse.status >= 400) throw new Error(`Expense attribution failed: ${JSON.stringify(expenseResponse.body)}`);
    expenseAssignmentId = Number(expenseResponse.body.assignmentId);
    const expenseAfter = await accountingFor('2025-12');

    const commissionBefore = await accountingFor('2026-01');
    const commissionResponse = await post('/api/incentives/attributions/commissions', {
      moveLineId: commissionLine.id,
      employeeId: employee.id,
      reason: '[PHASE5 QA] assign exactly one employee',
    });
    if (commissionResponse.status >= 400) throw new Error(`Commission attribution failed: ${JSON.stringify(commissionResponse.body)}`);
    commissionAssignmentId = Number(commissionResponse.body.assignmentId);
    const commissionAfter = await accountingFor('2026-01');

    return {
      employee,
      expense: {
        moveId: expenseMoveId,
        moveName: move.name,
        testLineAmount: expenseLine.balance,
        unresolvedBefore: expenseBefore.unresolved.some((source) => source.type === 'employee_expense' && Number(source.sourceId) === expenseMoveId),
        beforeEmployeeExpenses: expenseBefore.accounting?.employeeExpenses,
        afterEmployeeExpenses: expenseAfter.accounting?.employeeExpenses,
        resolvedAfter: !expenseAfter.unresolved.some((source) => source.type === 'employee_expense' && Number(source.sourceId) === expenseMoveId),
      },
      commission: {
        lineId: commissionLine.id,
        moveId: id(commissionLine.move_id),
        amount: commissionLine.balance,
        unresolvedBefore: commissionBefore.unresolved.some((source) => source.type === 'commission_assignment' && Number(source.sourceId) === commissionLine.id),
        beforeCommission: commissionBefore.accounting?.commission,
        afterCommission: commissionAfter.accounting?.commission,
        resolvedAfter: !commissionAfter.unresolved.some((source) => source.type === 'commission_assignment' && Number(source.sourceId) === commissionLine.id),
      },
      cleanup: 'temporary attribution rows removed in finally',
    };
  } finally {
    if (commissionAssignmentId !== null) {
      await defaultOdooGateway.unlink(INCENTIVE_STUDIO_MODELS.commissionAssignment, [commissionAssignmentId]);
    }
    if (expenseAssignmentId !== null) {
      await defaultOdooGateway.unlink(INCENTIVE_STUDIO_MODELS.expenseAssignment, [expenseAssignmentId]);
    }
  }
}

async function main() {
  loadEnvironment();
  const command = process.argv[2] ?? 'inspect';
  if (command === 'inspect') {
    process.stdout.write(`${JSON.stringify(await inspect(), null, 2)}\n`);
    return;
  }
  if (command === 'http') {
    process.stdout.write(`${JSON.stringify(await httpSmoke(process.argv[3] ?? 'http://127.0.0.1:3105'), null, 2)}\n`);
    return;
  }
  if (command === 'workflow') {
    process.stdout.write(`${JSON.stringify(await workflow(process.argv[3] ?? 'http://127.0.0.1:3105'), null, 2)}\n`);
    return;
  }
  if (command === 'workflow-status') {
    process.stdout.write(`${JSON.stringify(await workflowStatus(process.argv[3] ?? 'http://127.0.0.1:3105'), null, 2)}\n`);
    return;
  }
  if (command === 'attributions') {
    process.stdout.write(`${JSON.stringify(await attributionWorkflow(process.argv[3] ?? 'http://127.0.0.1:3105'), null, 2)}\n`);
    return;
  }
  throw new Error(`Unsupported Phase 5 command: ${command}`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
