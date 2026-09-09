import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateIncentives } from '../src/lib/incentives/engine';
import type {
  IncentiveEngineInput,
  IncentivePresetV1,
  MonthlyIncentiveResult,
  NormalizedAccountingMonth,
  NormalizedMonth,
} from '../src/lib/incentives/types';
import { defaultOdooGateway } from '../src/lib/incentives/odoo/gateway';
import { fetchIncentiveSourceBundle } from '../src/lib/incentives/odoo/extraction';
import { normalizeOdooIncentiveData } from '../src/lib/incentives/odoo/normalization';
import { StudioIncentiveRepository } from '../src/lib/incentives/odoo/studio-repository';
import { INCENTIVE_STUDIO_MODELS } from '../src/lib/incentives/odoo/studio-schema';
import { odooCall } from '../src/lib/odoo/client';

type Many2one = false | [number, string];

interface EmployeeRecord {
  id: number;
  name: string;
  wage: number;
}

type ExpectedValue = number | string | boolean | null;

interface UatCase {
  id: string;
  title: string;
  input: string[];
  expectedBusinessResult: string;
  expected: Record<string, ExpectedValue>;
  actual: ReturnType<typeof calculationReport> & Record<string, unknown>;
  pass: boolean;
  mismatches: string[];
  sourceRecords: string[];
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

function clonePreset(preset: IncentivePresetV1, code: string, name: string): IncentivePresetV1 {
  return { ...structuredClone(preset), code, name };
}

function accounting(overrides: Partial<NormalizedAccountingMonth> = {}): NormalizedAccountingMonth {
  return {
    netSales: 0,
    cogs: 0,
    transport: 0,
    loading: 0,
    signedAccountingAdjustments: 0,
    employeeExpenses: 0,
    commission: 0,
    ...overrides,
  };
}

function monthWithBase(month: string, actualBase: number): NormalizedMonth {
  return { month, accounting: accounting({ netSales: actualBase }) };
}

function controlledInput(params: {
  employee: EmployeeRecord;
  preset: IncentivePresetV1;
  months: NormalizedMonth[];
  adjustments?: IncentiveEngineInput['adjustments'];
}): IncentiveEngineInput {
  return {
    employeeId: params.employee.id,
    companyId: 1,
    preset: params.preset,
    months: params.months,
    salaryHistory: [{
      id: `uat-salary:${params.employee.id}`,
      employeeId: params.employee.id,
      effectiveFrom: '2000-01-01',
      monthlyWage: params.employee.wage,
    }],
    customerEvents: [],
    adjustments: params.adjustments ?? [],
  };
}

function calculationReport(
  employee: EmployeeRecord,
  result: MonthlyIncentiveResult,
  presetVersion: string,
) {
  return {
    employee: `${employee.name} (hr.employee(${employee.id}))`,
    month: result.month,
    presetVersion,
    wage: result.mainIncentive.salaryUsed,
    sales: result.accounting.netSales,
    cogs: result.accounting.cogs,
    grossMargin: result.accounting.grossMargin,
    transport: result.accounting.transport,
    loading: result.accounting.loading,
    signedAccountingAdjustments: result.accounting.signedAccountingAdjustments,
    adjustedGrossMargin: result.accounting.adjustedGrossMargin,
    employeeExpenses: result.accounting.employeeExpenses,
    commission: result.accounting.commission,
    actualBase: result.accounting.actualBase,
    structure: result.mainIncentive.structure,
    flatThreshold: result.mainIncentive.flatThreshold,
    firstSlabThreshold: result.mainIncentive.firstSlabThreshold,
    carryIn: result.mainIncentive.carryIn,
    carryOut: result.mainIncentive.carryOut,
    requiredThreshold: result.mainIncentive.requiredThreshold,
    carryConsumed: result.mainIncentive.carryConsumed,
    currentRecognizedBase: result.mainIncentive.currentRecognizedBase,
    accumulatedUnpaidBaseIn: result.mainIncentive.accumulatedUnpaidBaseIn,
    accumulatedUnpaidBaseOut: result.mainIncentive.accumulatedUnpaidBaseOut,
    eligibleIncentiveBase: result.mainIncentive.eligibleIncentiveBase,
    slabSelectionBase: result.mainIncentive.slabSelectionBase,
    achievedRate: result.mainIncentive.achievedRate,
    mainIncentive: result.mainIncentive.incentive,
    newCustomerBonus: result.customerIncentive.newCustomerBonus,
    repeatBonus: result.customerIncentive.repeatCustomerBonus,
    adjustments: result.adjustmentTotal,
    finalIncentive: result.finalIncentive,
    noticeStatus: result.performanceNoticeTriggered,
  };
}

function sameValue(actual: unknown, expected: ExpectedValue): boolean {
  return typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.005
    : actual === expected;
}

function makeCase(params: {
  id: string;
  title: string;
  input: string[];
  expectedBusinessResult: string;
  expected: Record<string, ExpectedValue>;
  employee: EmployeeRecord;
  result: MonthlyIncentiveResult;
  presetVersion: string;
  sourceRecords: string[];
  extraActual?: Record<string, ExpectedValue>;
}): UatCase {
  const actual: UatCase['actual'] = {
    ...calculationReport(params.employee, params.result, params.presetVersion),
    ...params.extraActual,
  };
  const mismatches = Object.entries(params.expected).flatMap(([field, expected]) => (
    sameValue(actual[field], expected)
      ? []
      : [`${field}: expected ${String(expected)}, actual ${String(actual[field])}`]
  ));
  return {
    id: params.id,
    title: params.title,
    input: params.input,
    expectedBusinessResult: params.expectedBusinessResult,
    expected: params.expected,
    actual,
    pass: mismatches.length === 0,
    mismatches,
    sourceRecords: params.sourceRecords,
  };
}

function newCustomerCountCase(params: {
  id: string;
  employee: EmployeeRecord;
  preset: IncentivePresetV1;
  primaryCount: number;
  secondaryCount: number;
  expectedPrimaryBonus: number;
  expectedSecondaryBonus: number;
}): UatCase {
  const secondaryEmployee: EmployeeRecord = {
    id: params.employee.id + 1000,
    name: 'Controlled Secondary Employee',
    wage: params.employee.wage,
  };
  let customerId = 9200;
  const customerEvents: IncentiveEngineInput['customerEvents'] = [
    ...Array.from({ length: params.primaryCount }, () => {
      customerId += 1;
      return {
        kind: 'new_customer' as const,
        id: `${params.id}-primary-${customerId}`,
        customerId,
        eventDate: '2098-01-05',
        billing: 200000,
        grossMargin: 20000,
        ownership: { status: 'resolved' as const, employeeId: params.employee.id, source: 'manual_resolution' as const },
      };
    }),
    ...Array.from({ length: params.secondaryCount }, () => {
      customerId += 1;
      return {
        kind: 'new_customer' as const,
        id: `${params.id}-secondary-${customerId}`,
        customerId,
        eventDate: '2098-01-05',
        billing: 200000,
        grossMargin: 20000,
        ownership: { status: 'resolved' as const, employeeId: secondaryEmployee.id, source: 'manual_resolution' as const },
      };
    }),
  ];
  const calculateForEmployee = (targetEmployee: EmployeeRecord) => {
    const input = controlledInput({
      employee: targetEmployee,
      preset: params.preset,
      months: [monthWithBase('2098-01', 0)],
    });
    input.customerEvents = customerEvents;
    return calculateIncentives(input).months[0];
  };
  const primaryResult = calculateForEmployee(params.employee);
  const secondaryResult = calculateForEmployee(secondaryEmployee);
  return makeCase({
    id: params.id,
    title: `New customer employee count split ${params.primaryCount}/${params.secondaryCount}`,
    employee: params.employee,
    result: primaryResult,
    presetVersion: `${params.preset.name} / schema ${params.preset.schemaVersion}`,
    input: [
      `${params.primaryCount + params.secondaryCount} globally qualifying new customers`,
      `Ownership split ${params.primaryCount}/${params.secondaryCount} between two employees`,
      `Employee-level minimum ${params.preset.newCustomer.minimumQualifyingCustomers}`,
    ],
    expectedBusinessResult: `Primary employee bonus INR ${params.expectedPrimaryBonus}; secondary employee bonus INR ${params.expectedSecondaryBonus}.`,
    expected: {
      newCustomerBonus: params.expectedPrimaryBonus,
      secondaryEmployeeBonus: params.expectedSecondaryBonus,
    },
    extraActual: {
      secondaryEmployeeBonus: secondaryResult.customerIncentive.newCustomerBonus,
    },
    sourceRecords: [`Controlled normalized ${params.id} events; no Odoo mutation`],
  });
}

function controlledCase(params: {
  id: string;
  title: string;
  input: string[];
  expectedBusinessResult: string;
  expected: Record<string, ExpectedValue>;
  employee: EmployeeRecord;
  preset: IncentivePresetV1;
  months: NormalizedMonth[];
  targetIndex?: number;
  adjustments?: IncentiveEngineInput['adjustments'];
  sourceRecords?: string[];
}): UatCase {
  const engineResult = calculateIncentives(controlledInput({
    employee: params.employee,
    preset: params.preset,
    months: params.months,
    adjustments: params.adjustments,
  }));
  const targetIndex = params.targetIndex ?? engineResult.months.length - 1;
  return makeCase({
    ...params,
    result: engineResult.months[targetIndex],
    presetVersion: `${params.preset.name} / schema ${params.preset.schemaVersion}`,
    sourceRecords: params.sourceRecords ?? [
      `Controlled normalized UAT input for hr.employee(${params.employee.id}); no Odoo accounting mutation`,
    ],
  });
}

function accountingEffect(
  moveId: number,
  bundle: Awaited<ReturnType<typeof fetchIncentiveSourceBundle>>,
) {
  const accountById = new Map(bundle.accounts.map((account) => [account.id, account]));
  const relevantLines = bundle.lines.filter((line) => line.moveId === moveId);
  const sales = relevantLines.reduce((total, line) => (
    accountById.get(line.accountId)?.accountType === 'income' ? total - line.balance : total
  ), 0);
  const cogs = relevantLines.reduce((total, line) => (
    accountById.get(line.accountId)?.accountType === 'expense_direct_cost' ? total + line.balance : total
  ), 0);
  return { sales, cogs, grossMargin: sales - cogs };
}

async function runUat() {
  const context = await odooCall<{ uid: number }>('res.users', 'context_get', {});
  const users = await defaultOdooGateway.searchRead<{ company_id: Many2one }>(
    'res.users', [['id', '=', context.uid]], ['company_id'], { limit: 1 },
  );
  const companyId = many2oneId(users[0].company_id);
  if (!companyId) throw new Error('Odoo API user has no current company');
  const employees = await defaultOdooGateway.searchReadAll<EmployeeRecord>(
    'hr.employee', [['company_id', '=', companyId], ['active', '=', true], ['wage', '=', 20000]], ['id', 'name', 'wage'], { order: 'id' },
  );
  const employee = employees.find((record) => record.id === 4) ?? employees[0];
  if (!employee) throw new Error('No active INR 20,000 employee was found');
  const repository = new StudioIncentiveRepository(defaultOdooGateway);
  const bundle = await fetchIncentiveSourceBundle({
    companyId,
    periodStart: '2025-08-01',
    periodEnd: '2026-08-31',
    gateway: defaultOdooGateway,
    attributionReader: repository,
  });
  const normalized = normalizeOdooIncentiveData(bundle);
  const standard = JSON.parse(readFileSync(
    resolve(process.cwd(), 'docs/incentives/initial-standard-preset.json'),
    'utf8',
  )) as IncentivePresetV1;
  const flatNoCarry = clonePreset(standard, 'UAT_FLAT_NO_CARRY', 'UAT Flat No Carry');
  if (flatNoCarry.mainIncentive.structure !== 'flat') throw new Error('Expected Flat preset');
  flatNoCarry.mainIncentive.flat.carryForwardEnabled = false;
  flatNoCarry.mainIncentive.flat.previousBasePayout = 'current_month_only';
  const flatCurrentOnly = clonePreset(standard, 'UAT_FLAT_CURRENT_ONLY', 'UAT Flat Carry Current Month Only');
  if (flatCurrentOnly.mainIncentive.structure !== 'flat') throw new Error('Expected Flat preset');
  flatCurrentOnly.mainIncentive.flat.previousBasePayout = 'current_month_only';
  const flatAbove = clonePreset(flatNoCarry, 'UAT_FLAT_ABOVE', 'UAT Flat Above Threshold Only');
  if (flatAbove.mainIncentive.structure !== 'flat') throw new Error('Expected Flat preset');
  flatAbove.mainIncentive.flat.payoutBasis = 'above_threshold_only';
  const fixedSlab = clonePreset(standard, 'UAT_SLAB_FIXED', 'UAT Fixed Amount Slabs');
  fixedSlab.mainIncentive = {
    structure: 'slab',
    flat: null,
    slab: {
      thresholdType: 'fixed_amount',
      carryForwardEnabled: true,
      slabApplication: 'whole_eligible_base',
      slabs: [
        { minimumBase: 120000, rate: 0.1 },
        { minimumBase: 150000, rate: 0.125 },
        { minimumBase: 180000, rate: 0.15 },
        { minimumBase: 200000, rate: 0.2 },
      ],
    },
  };
  const fixedSlabNoCarry = clonePreset(fixedSlab, 'UAT_SLAB_FIXED_NO_CARRY', 'UAT Fixed Amount Slabs No Carry');
  if (fixedSlabNoCarry.mainIncentive.structure !== 'slab') throw new Error('Expected Slab preset');
  fixedSlabNoCarry.mainIncentive.slab.carryForwardEnabled = false;
  const salarySlab = clonePreset(standard, 'UAT_SLAB_SALARY', 'UAT Salary Multiple Slabs');
  salarySlab.mainIncentive = {
    structure: 'slab',
    flat: null,
    slab: {
      thresholdType: 'salary_multiple',
      carryForwardEnabled: false,
      slabApplication: 'whole_eligible_base',
      slabs: [
        { minimumMultiplier: 3, rate: 0.1 },
        { minimumMultiplier: 3.5, rate: 0.125 },
        { minimumMultiplier: 4, rate: 0.15 },
      ],
    },
  };

  const cases: UatCase[] = [
    controlledCase({
      id: 'A', title: 'Flat + no carry', employee, preset: flatNoCarry,
      months: [monthWithBase('2098-01', 80000)],
      input: ['Wage INR 20,000', 'Threshold 6x = INR 120,000', 'Actual Base INR 80,000', 'Carry disabled'],
      expectedBusinessResult: 'Threshold fails, no incentive, and no shortfall is carried.',
      expected: { requiredThreshold: 120000, carryOut: 0, eligibleIncentiveBase: 0, mainIncentive: 0 },
    }),
    controlledCase({
      id: 'B', title: 'Flat + carry', employee, preset: flatCurrentOnly,
      months: [monthWithBase('2098-01', 80000), monthWithBase('2098-02', 160000)],
      input: ['Month 1 Actual Base INR 80,000', 'Month 1 shortfall INR 40,000', 'Month 2 Actual Base INR 160,000', 'Current-month-only payout'],
      expectedBusinessResult: 'Month 2 must satisfy INR 160,000 and consumes INR 40,000 carry; current month base earns 10%.',
      expected: { carryIn: 40000, requiredThreshold: 160000, carryConsumed: 40000, eligibleIncentiveBase: 160000, mainIncentive: 16000 },
    }),
    controlledCase({
      id: 'C', title: 'Flat + previous base included', employee, preset: standard,
      months: [monthWithBase('2098-01', 80000), monthWithBase('2098-02', 160000)],
      input: ['Month 1 unpaid base INR 80,000', 'Month 2 Actual Base INR 160,000', 'Include previous unpaid base'],
      expectedBusinessResult: 'Accumulated INR 240,000 becomes eligible once the INR 160,000 accumulated requirement is met.',
      expected: { carryIn: 40000, requiredThreshold: 160000, accumulatedUnpaidBaseIn: 80000, eligibleIncentiveBase: 240000, mainIncentive: 24000, accumulatedUnpaidBaseOut: 0 },
    }),
    controlledCase({
      id: 'D', title: 'Flat + previous base excluded', employee, preset: flatCurrentOnly,
      months: [monthWithBase('2098-01', 80000), monthWithBase('2098-02', 160000)],
      input: ['Month 1 Actual Base INR 80,000', 'Month 2 Actual Base INR 160,000', 'Current month only'],
      expectedBusinessResult: 'Prior base is not paid; only Month 2 INR 160,000 earns 10%.',
      expected: { accumulatedUnpaidBaseIn: 0, eligibleIncentiveBase: 160000, mainIncentive: 16000 },
    }),
    controlledCase({
      id: 'E', title: 'Flat + above-threshold-only', employee, preset: flatAbove,
      months: [monthWithBase('2098-01', 200000)],
      input: ['Actual Base INR 200,000', 'Threshold INR 120,000', 'Above-threshold-only payout'],
      expectedBusinessResult: 'Only INR 80,000 above threshold earns 10%.',
      expected: { requiredThreshold: 120000, eligibleIncentiveBase: 80000, mainIncentive: 8000 },
    }),
    controlledCase({
      id: 'F', title: 'Slab + no carry', employee, preset: fixedSlabNoCarry,
      months: [monthWithBase('2098-01', 170000)],
      input: ['Fixed slabs INR 120k/150k/180k/200k', 'Actual Base INR 170,000', 'Carry disabled'],
      expectedBusinessResult: 'Highest matching slab is INR 150,000 at 12.5%; rate applies to whole INR 170,000.',
      expected: { carryOut: 0, firstSlabThreshold: 120000, slabSelectionBase: 170000, achievedRate: 0.125, eligibleIncentiveBase: 170000, mainIncentive: 21250 },
    }),
    controlledCase({
      id: 'G', title: 'Slab + carry', employee, preset: fixedSlab,
      months: [monthWithBase('2098-01', 80000), monthWithBase('2098-02', 160000)],
      input: ['Month 1 Actual Base INR 80,000', 'Carry INR 40,000', 'Month 2 Actual Base INR 160,000'],
      expectedBusinessResult: 'Carry is consumed before slab selection; current recognized base is INR 120,000 at 10%, with no previous-base payout.',
      expected: { carryIn: 40000, requiredThreshold: 160000, carryConsumed: 40000, currentRecognizedBase: 120000, slabSelectionBase: 120000, achievedRate: 0.1, eligibleIncentiveBase: 120000, mainIncentive: 12000 },
    }),
    controlledCase({
      id: 'H', title: 'Slab fixed-amount thresholds', employee, preset: fixedSlabNoCarry,
      months: [monthWithBase('2098-01', 205000)],
      input: ['Fixed thresholds INR 120k, 150k, 180k, 200k', 'Actual Base INR 205,000'],
      expectedBusinessResult: 'Highest matching INR 200,000 slab wins; 20% applies to whole INR 205,000.',
      expected: { firstSlabThreshold: 120000, achievedRate: 0.2, eligibleIncentiveBase: 205000, mainIncentive: 41000 },
    }),
    controlledCase({
      id: 'I', title: 'Slab salary-multiple thresholds', employee, preset: salarySlab,
      months: [monthWithBase('2098-01', 75000)],
      input: ['Wage INR 20,000', 'Slabs 3x/3.5x/4x', 'Actual Base INR 75,000'],
      expectedBusinessResult: 'Thresholds resolve to INR 60k/70k/80k; 3.5x at 12.5% applies to INR 75,000.',
      expected: { firstSlabThreshold: 60000, achievedRate: 0.125, eligibleIncentiveBase: 75000, mainIncentive: 9375 },
    }),
    controlledCase({
      id: 'J', title: 'Negative Actual Base', employee, preset: standard,
      months: [monthWithBase('2098-01', -70000)],
      input: ['Actual Base -INR 70,000', 'Normal threshold INR 120,000', 'Carry enabled'],
      expectedBusinessResult: 'Negative base is allowed and increases carry to INR 190,000; no incentive is paid.',
      expected: { actualBase: -70000, requiredThreshold: 120000, carryOut: 190000, eligibleIncentiveBase: 0, mainIncentive: 0 },
    }),
  ];

  const salaryHistory = normalized.salaryHistoryByEmployee[String(employee.id)];
  const liveMonths = normalized.monthsByEmployee[String(employee.id)]
    .filter((month) => `${month.month}-01` >= salaryHistory[0].effectiveFrom);
  const liveInput: IncentiveEngineInput = {
    employeeId: employee.id,
    companyId,
    preset: standard,
    months: liveMonths,
    salaryHistory,
    customerEvents: normalized.customerEvents,
    adjustments: [],
  };
  const liveResult = calculateIncentives(liveInput);
  const december = liveResult.months.find((month) => month.month === '2025-12');
  const june = liveResult.months.find((month) => month.month === '2026-06');
  if (!december || !june) throw new Error('Required live UAT months are unavailable');
  const expenseSources = normalized.sourceAudit.filter((source) => (
    source.employeeId === employee.id && source.month === '2025-12' && source.category === 'employee_expense'
  ));
  cases.push(makeCase({
    id: 'K', title: 'Employee expense deduction', employee, result: december,
    presetVersion: 'Sunlectric Standard Sales Incentive / schema 1.0',
    input: ['Live December 2025 accounting', 'Posted employee expense INR 4,242', 'Expense deduction enabled'],
    expectedBusinessResult: 'Adjusted GM INR 1,647,341.15 less expense INR 4,242 gives Actual Base INR 1,643,099.15.',
    expected: { employeeExpenses: 4242, adjustedGrossMargin: 1647341.15, actualBase: 1643099.15, mainIncentive: 164309.92 },
    sourceRecords: expenseSources.map((source) => `account.move.line(${source.sourceId}) / account.move(${source.moveId}) / signed INR ${source.signedAmount}`),
  }));

  const january = liveMonths.find((month) => month.month === '2026-01');
  if (!january) throw new Error('January 2026 live month is unavailable');
  const commissionAmount = 49926;
  const commissionMonths = liveMonths.map((month) => month.month === '2026-01'
    ? { ...month, accounting: { ...month.accounting, commission: commissionAmount } }
    : month);
  const commissionResult = calculateIncentives({ ...liveInput, months: commissionMonths });
  const commissionJanuary = commissionResult.months.find((month) => month.month === '2026-01')!;
  const baselineJanuary = liveResult.months.find((month) => month.month === '2026-01')!;
  cases.push(makeCase({
    id: 'L', title: 'Commission deduction', employee, result: commissionJanuary,
    presetVersion: 'Sunlectric Standard Sales Incentive / schema 1.0',
    input: [`Live January baseline Actual Base INR ${baselineJanuary.accounting.actualBase}`, `Assigned commission INR ${commissionAmount}`, 'Commission deduction enabled'],
    expectedBusinessResult: 'Assigned account 211810 commission reduces Actual Base once by INR 49,926.',
    expected: { commission: commissionAmount, actualBase: baselineJanuary.accounting.actualBase - commissionAmount },
    sourceRecords: ['account.move.line(9100)', 'account.move(2935) BILL/25-26/01/0021', 'account.account 211810 Sales Commission Expense'],
  }));

  const refund = bundle.moves.find((move) => move.id === 557);
  const invoice = bundle.moves.find((move) => move.id === 556);
  if (!refund || !invoice) throw new Error('Reference invoice/refund pair is unavailable');
  const invoiceEffect = accountingEffect(invoice.id, bundle);
  const refundEffect = accountingEffect(refund.id, bundle);
  const pairAccounting = accounting({
    netSales: invoiceEffect.sales + refundEffect.sales,
    cogs: invoiceEffect.cogs + refundEffect.cogs,
  });
  const creditPreset = clonePreset(flatNoCarry, 'UAT_CREDIT_NOTE', 'UAT Credit Note Accounting');
  cases.push(controlledCase({
    id: 'M', title: 'Credit-note effect', employee, preset: creditPreset,
    months: [{ month: '2098-01', accounting: pairAccounting }],
    input: [`Invoice Sales ${invoiceEffect.sales}, COGS ${invoiceEffect.cogs}`, `Refund Sales ${refundEffect.sales}, COGS ${refundEffect.cogs}`, 'No manual credit-note deduction'],
    expectedBusinessResult: 'Signed invoice and refund lines net Sales to zero and COGS to -INR 2,831.31, producing GM +INR 2,831.31 exactly once.',
    expected: { sales: 0, cogs: -2831.31, grossMargin: 2831.31, actualBase: 2831.31 },
    sourceRecords: ['account.move(556) SL/FY25-26/054', 'account.move(557) RMHD/25-26/0002', 'Sales account 50103000', 'COGS account 60101000'],
  }));

  cases.push(makeCase({
    id: 'N', title: 'New customer incentive', employee, result: june,
    presetVersion: 'Sunlectric Standard Sales Incentive / schema 1.0',
    input: ['Live June 2026 company-global customer history', 'Strict billing > INR 100,000', 'Minimum GM 3.5%', 'Minimum count 3', 'Bonus INR 2,000/customer'],
    expectedBusinessResult: 'Three qualifying new customers owned by employee 4 produce INR 6,000.',
    expected: { newCustomerBonus: 6000 },
    sourceRecords: ['new:13302:7127', 'new:13291:7265', 'new:13320:7274', 'res.partner(13302,13291,13320)'],
  }));
  cases.push(
    newCustomerCountCase({
      id: 'N-COUNT-2-1', employee, preset: standard, primaryCount: 2, secondaryCount: 1,
      expectedPrimaryBonus: 0, expectedSecondaryBonus: 0,
    }),
    newCustomerCountCase({
      id: 'N-COUNT-3-1', employee, preset: standard, primaryCount: 3, secondaryCount: 1,
      expectedPrimaryBonus: 6000, expectedSecondaryBonus: 0,
    }),
    newCustomerCountCase({
      id: 'N-COUNT-3-3', employee, preset: standard, primaryCount: 3, secondaryCount: 3,
      expectedPrimaryBonus: 6000, expectedSecondaryBonus: 6000,
    }),
    newCustomerCountCase({
      id: 'N-COUNT-4-2', employee, preset: standard, primaryCount: 4, secondaryCount: 2,
      expectedPrimaryBonus: 8000, expectedSecondaryBonus: 0,
    }),
  );
  cases.push(makeCase({
    id: 'O', title: 'Repeat customer incentive', employee, result: june,
    presetVersion: 'Sunlectric Standard Sales Incentive / schema 1.0',
    input: ['Live June 2026 global history', 'Repeat window 90 days', 'Maximum one payout/customer', 'Bonus INR 2,000/repeat'],
    expectedBusinessResult: 'Two qualifying repeat events owned by employee 4 produce INR 4,000; payout limit remains one per customer.',
    expected: { repeatBonus: 4000 },
    sourceRecords: ['repeat:13320:7343 -> new:13320:7274', 'repeat:13327:7341 -> new:13327:7207', 'res.partner(13320,13327)'],
  }));
  const repeatRulesPreset = clonePreset(standard, 'UAT_REPEAT_RULES', 'UAT Repeat Window and GM');
  repeatRulesPreset.newCustomer.enabled = false;
  repeatRulesPreset.repeatCustomer.minimumBilling = 50000;
  repeatRulesPreset.repeatCustomer.minimumGmAmount = 5000;
  repeatRulesPreset.repeatCustomer.minimumGmPercent = 10;
  repeatRulesPreset.repeatCustomer.maximumPayoutsPerCustomer = null;
  const repeatInput = controlledInput({ employee, preset: repeatRulesPreset, months: [monthWithBase('2098-04', 0)] });
  repeatInput.customerEvents = [
    { kind: 'new_customer', id: 'uat-repeat-new', customerId: 9100, eventDate: '2098-01-01', billing: 200000, grossMargin: 20000, ownership: { status: 'resolved', employeeId: employee.id, source: 'manual_resolution' } },
    { kind: 'repeat_customer', id: 'uat-repeat-low-gm', customerId: 9100, newCustomerEventId: 'uat-repeat-new', eventDate: '2098-01-10', billing: 50000, grossMargin: 4999, ownership: { status: 'resolved', employeeId: employee.id, source: 'manual_resolution' } },
    { kind: 'repeat_customer', id: 'uat-repeat-day-90', customerId: 9100, newCustomerEventId: 'uat-repeat-new', eventDate: '2098-04-01', billing: 50000, grossMargin: 5000, ownership: { status: 'resolved', employeeId: employee.id, source: 'manual_resolution' } },
    { kind: 'repeat_customer', id: 'uat-repeat-day-91', customerId: 9100, newCustomerEventId: 'uat-repeat-new', eventDate: '2098-04-02', billing: 50000, grossMargin: 5000, ownership: { status: 'resolved', employeeId: employee.id, source: 'manual_resolution' } },
  ];
  const repeatRulesResult = calculateIncentives(repeatInput).months[0];
  cases.push(makeCase({
    id: 'O-RULES', title: 'Repeat window and GM conditions', employee, result: repeatRulesResult,
    presetVersion: `${repeatRulesPreset.name} / schema 1.0`,
    input: ['Minimum billing INR 50,000', 'Minimum GM INR 5,000 and 10%', 'Window 90 days', 'Day 90 and day 91 events'],
    expectedBusinessResult: 'Low-GM and day-91 events fail; day-90 event qualifies and pays INR 2,000.',
    expected: { repeatBonus: 2000 },
    sourceRecords: ['Controlled normalized events uat-repeat-new/low-gm/day-90/day-91; no Odoo mutation'],
  }));

  const calculations = await defaultOdooGateway.searchReadAll<{
    id: number;
    x_employee_id: Many2one;
    x_result_snapshot_json: string;
  }>(INCENTIVE_STUDIO_MODELS.calculation, [['id', '=', 2]], ['id', 'x_employee_id', 'x_result_snapshot_json']);
  const adjustmentRecords = await defaultOdooGateway.searchReadAll<{ id: number; x_operation: string; x_amount: number }>(
    INCENTIVE_STUDIO_MODELS.adjustment, [['x_calculation_id', '=', 2]], ['id', 'x_operation', 'x_amount'], { order: 'id' },
  );
  const qaEmployeeId = many2oneId(calculations[0]?.x_employee_id ?? false);
  const qaEmployee = employees.find((record) => record.id === qaEmployeeId)
    ?? await defaultOdooGateway.searchRead<EmployeeRecord>('hr.employee', [['id', '=', qaEmployeeId]], ['id', 'name', 'wage'], { limit: 1 }).then((records) => records[0]);
  if (!qaEmployee) throw new Error('Phase 5 QA calculation employee is unavailable');
  const qaResult = JSON.parse(calculations[0].x_result_snapshot_json) as MonthlyIncentiveResult;
  cases.push(makeCase({
    id: 'P', title: 'Adjustment', employee: qaEmployee, result: qaResult,
    presetVersion: 'Active locked Standard-equivalent version 1',
    input: ['Approved QA calculation 2', 'Raw incentive INR 0', '+INR 1,000', '-INR 250'],
    expectedBusinessResult: 'Raw incentive remains INR 0; adjustment total is INR 750; final incentive is INR 750.',
    expected: { mainIncentive: 0, adjustments: 750, finalIncentive: 750 },
    sourceRecords: [`x_sunlectric_incentive_calculation(2)`, ...adjustmentRecords.map((record) => `x_sunlectric_incentive_adjustment(${record.id}) ${record.x_operation} INR ${record.x_amount}`)],
  }));

  cases.push(controlledCase({
    id: 'Q', title: 'Notice streak', employee, preset: standard,
    months: [
      monthWithBase('2098-01', 0),
      monthWithBase('2098-02', 0),
      monthWithBase('2098-03', 0),
      monthWithBase('2098-04', 0),
    ],
    input: ['Four consecutive months below the required threshold', 'Performance notice threshold 4 failed months'],
    expectedBusinessResult: 'No notice in months 1-3; notice triggers in month 4.',
    expected: { noticeStatus: true, carryOut: 480000, mainIncentive: 0 },
  }));

  const customerEventIds = new Set(['new:13302:7127', 'new:13291:7265', 'new:13320:7274', 'new:13327:7207', 'repeat:13320:7343', 'repeat:13327:7341']);
  const customerEvents = normalized.customerEvents.filter((event) => customerEventIds.has(event.id));
  return {
    generatedAt: new Date().toISOString(),
    companyId,
    employeePopulation: employees,
    selectedEmployee: employee,
    preset: {
      code: standard.code,
      schemaVersion: standard.schemaVersion,
      thresholdSalaryMultiplier: standard.mainIncentive.structure === 'flat'
        ? standard.mainIncentive.flat.threshold.salaryMultiplier
        : null,
      rate: standard.mainIncentive.structure === 'flat' ? standard.mainIncentive.flat.rate : null,
    },
    cases,
    summary: {
      total: cases.length,
      passed: cases.filter((testCase) => testCase.pass).length,
      failed: cases.filter((testCase) => !testCase.pass).length,
    },
    accountingEvidence: {
      invoice: { id: invoice.id, name: invoice.name, ...invoiceEffect },
      creditNote: { id: refund.id, name: refund.name, ...refundEffect },
      expenseSources,
      commission: { lineId: 9100, moveId: 2935, amount: commissionAmount, accountCode: '211810' },
    },
    customerEvidence: customerEvents,
    repeatCustomerHistory: normalized.customerEvents.filter((event) => [13320, 13327].includes(event.customerId)),
  };
}

loadEnvironment();
runUat()
  .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
