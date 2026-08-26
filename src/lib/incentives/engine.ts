import { calculateCustomerIncentivesForMonth, qualifiesAsNewCustomer } from './customer-incentive';
import { calculateMainIncentive } from './main-incentive';
import { roundMoney, sumMoney } from './money';
import { resolveSalaryForMonth } from './salary';
import { cloneCalculationState, createInitialCalculationState } from './state';
import type {
  AccountingCalculation,
  IncentiveEngineInput,
  IncentiveEngineResult,
  NormalizedNewCustomerEvent,
} from './types';
import { validateEngineInput } from './validation';

function calculateAccounting(
  accounting: IncentiveEngineInput['months'][number]['accounting'],
  preset: IncentiveEngineInput['preset'],
): AccountingCalculation {
  const netSales = roundMoney(accounting.netSales);
  const cogs = roundMoney(accounting.cogs);
  const grossMargin = roundMoney(netSales - cogs);
  const transport = roundMoney(accounting.transport);
  const loading = roundMoney(accounting.loading);
  const signedAccountingAdjustments = roundMoney(accounting.signedAccountingAdjustments);
  const adjustedGrossMargin = roundMoney(
    grossMargin - transport - loading + signedAccountingAdjustments,
  );
  const employeeExpenses = preset.base.deductEmployeeExpenses
    ? roundMoney(accounting.employeeExpenses)
    : 0;
  const commission = preset.base.deductCommission
    ? roundMoney(accounting.commission)
    : 0;
  const actualBase = roundMoney(adjustedGrossMargin - employeeExpenses - commission);

  return {
    netSales,
    cogs,
    grossMargin,
    transport,
    loading,
    signedAccountingAdjustments,
    adjustedGrossMargin,
    employeeExpenses,
    commission,
    actualBase,
  };
}

export function calculateIncentives(input: IncentiveEngineInput): IncentiveEngineResult {
  validateEngineInput(input);
  let state = cloneCalculationState(input.initialState ?? createInitialCalculationState());
  const newEventsById = new Map<string, NormalizedNewCustomerEvent>();
  const newQualificationById = new Map<string, boolean>();
  for (const event of input.customerEvents) {
    if (event.kind !== 'new_customer') {
      continue;
    }
    newEventsById.set(event.id, event);
    newQualificationById.set(event.id, qualifiesAsNewCustomer(event, input.preset.newCustomer));
  }

  const monthlyResults: IncentiveEngineResult['months'] = [];
  for (const normalizedMonth of input.months) {
    const accounting = calculateAccounting(normalizedMonth.accounting, input.preset);
    const salary = resolveSalaryForMonth(
      normalizedMonth.month,
      input.salaryHistory,
      input.preset.salaryPolicy,
    );
    const main = calculateMainIncentive(
      accounting.actualBase,
      salary,
      input.preset.mainIncentive,
      state,
    );

    state.carryShortfall = main.carryOut;
    state.accumulatedUnpaidBase = main.accumulatedUnpaidBaseOut;
    state.consecutiveFailureCount = main.recognized
      ? 0
      : state.consecutiveFailureCount + 1;
    if (main.recognized) {
      state.cycleSequence += 1;
      state.lastRecognitionMonth = normalizedMonth.month;
    }

    const customer = calculateCustomerIncentivesForMonth({
      month: normalizedMonth.month,
      employeeId: input.employeeId,
      customerEvents: input.customerEvents,
      newEventsById,
      newQualificationById,
      preset: input.preset,
      state,
    });
    state = customer.state;
    state.lastProcessedMonth = normalizedMonth.month;

    const adjustments = input.adjustments.filter(
      (adjustment) => adjustment.month === normalizedMonth.month,
    );
    const adjustmentTotal = sumMoney(adjustments.map((adjustment) => (
      adjustment.operation === 'add' ? adjustment.amount : -adjustment.amount
    )));
    const calculatedIncentive = sumMoney([
      main.calculation.incentive,
      customer.calculation.newCustomerBonus,
      customer.calculation.repeatCustomerBonus,
    ]);
    const finalIncentive = roundMoney(calculatedIncentive + adjustmentTotal);
    const stateAfter = cloneCalculationState(state);

    monthlyResults.push({
      month: normalizedMonth.month,
      accounting,
      mainIncentive: main.calculation,
      customerIncentive: customer.calculation,
      calculatedIncentive,
      adjustments: adjustments.map((adjustment) => ({ ...adjustment })),
      adjustmentTotal,
      finalIncentive,
      performanceNoticeTriggered: input.preset.performanceNotice.enabled
        && state.consecutiveFailureCount >= input.preset.performanceNotice.consecutiveFailedMonths,
      resolutionIssues: customer.issues,
      stateAfter,
    });
  }

  return {
    employeeId: input.employeeId,
    companyId: input.companyId,
    presetCode: input.preset.code,
    currency: input.preset.currency,
    months: monthlyResults,
    finalState: cloneCalculationState(state),
    resolutionIssues: monthlyResults.flatMap((result) => result.resolutionIssues),
  };
}
