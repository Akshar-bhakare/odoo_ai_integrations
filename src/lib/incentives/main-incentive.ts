import { percentageOf, roundMoney } from './money';
import type {
  CalculationState,
  MainIncentiveCalculation,
  MainIncentiveConfig,
  Money,
} from './types';
import type { ResolvedSalary } from './salary';

interface MainCalculationResult {
  calculation: MainIncentiveCalculation;
  carryOut: Money;
  accumulatedUnpaidBaseOut: Money;
  recognized: boolean;
}

function calculateFlat(
  actualBase: Money,
  salary: ResolvedSalary,
  config: Extract<MainIncentiveConfig, { structure: 'flat' }>['flat'],
  state: CalculationState,
): MainCalculationResult {
  const flatThreshold = roundMoney(salary.monthlyWage * config.threshold.salaryMultiplier);
  const carryIn = config.carryForwardEnabled ? roundMoney(state.carryShortfall) : 0;
  const requiredThreshold = roundMoney(flatThreshold + carryIn);
  const thresholdMet = actualBase >= requiredThreshold;
  const carryOut = config.carryForwardEnabled && !thresholdMet
    ? roundMoney(requiredThreshold - actualBase)
    : 0;
  const accumulatedUnpaidBaseIn = config.previousBasePayout === 'include_previous_unpaid_base'
    ? roundMoney(state.accumulatedUnpaidBase)
    : 0;
  const candidateBase = config.previousBasePayout === 'include_previous_unpaid_base'
    ? roundMoney(accumulatedUnpaidBaseIn + actualBase)
    : actualBase;
  const accumulatedUnpaidBaseOut = config.previousBasePayout === 'include_previous_unpaid_base'
    && !thresholdMet
    ? candidateBase
    : 0;
  const eligibleIncentiveBase = !thresholdMet
    ? 0
    : config.payoutBasis === 'entire_eligible_base'
      ? candidateBase
      : roundMoney(Math.max(0, candidateBase - requiredThreshold));
  const incentive = thresholdMet ? percentageOf(eligibleIncentiveBase, config.rate) : 0;

  return {
    calculation: {
      structure: 'flat',
      salaryVersionId: salary.versionId,
      salaryUsed: salary.monthlyWage,
      flatThreshold,
      firstSlabThreshold: null,
      requiredThreshold,
      thresholdMet,
      carryIn,
      carryOut,
      carryConsumed: thresholdMet ? carryIn : 0,
      currentRecognizedBase: thresholdMet ? actualBase : 0,
      accumulatedUnpaidBaseIn,
      accumulatedUnpaidBaseOut,
      eligibleIncentiveBase,
      slabSelectionBase: null,
      achievedRate: thresholdMet ? config.rate : null,
      incentive,
    },
    carryOut,
    accumulatedUnpaidBaseOut,
    recognized: thresholdMet,
  };
}

function calculateSlab(
  actualBase: Money,
  salary: ResolvedSalary,
  config: Extract<MainIncentiveConfig, { structure: 'slab' }>['slab'],
  state: CalculationState,
): MainCalculationResult {
  const resolvedSlabs = config.thresholdType === 'fixed_amount'
    ? config.slabs.map((slab) => ({ threshold: roundMoney(slab.minimumBase), rate: slab.rate }))
    : config.slabs.map((slab) => ({
        threshold: roundMoney(salary.monthlyWage * slab.minimumMultiplier),
        rate: slab.rate,
      }));
  const firstSlabThreshold = resolvedSlabs[0].threshold;
  const carryIn = config.carryForwardEnabled ? roundMoney(state.carryShortfall) : 0;
  const requiredThreshold = roundMoney(firstSlabThreshold + carryIn);
  const thresholdMet = actualBase >= requiredThreshold;
  const carryOut = config.carryForwardEnabled && !thresholdMet
    ? roundMoney(requiredThreshold - actualBase)
    : 0;
  const carryConsumed = thresholdMet ? carryIn : 0;
  const currentRecognizedBase = thresholdMet
    ? roundMoney(actualBase - carryConsumed)
    : 0;
  const achievedSlab = thresholdMet
    ? [...resolvedSlabs].reverse().find((slab) => slab.threshold <= currentRecognizedBase) ?? null
    : null;
  const eligibleIncentiveBase = achievedSlab ? currentRecognizedBase : 0;
  const incentive = achievedSlab
    ? percentageOf(eligibleIncentiveBase, achievedSlab.rate)
    : 0;

  return {
    calculation: {
      structure: 'slab',
      salaryVersionId: salary.versionId,
      salaryUsed: salary.monthlyWage,
      flatThreshold: null,
      firstSlabThreshold,
      requiredThreshold,
      thresholdMet,
      carryIn,
      carryOut,
      carryConsumed,
      currentRecognizedBase,
      accumulatedUnpaidBaseIn: 0,
      accumulatedUnpaidBaseOut: 0,
      eligibleIncentiveBase,
      slabSelectionBase: thresholdMet ? currentRecognizedBase : null,
      achievedRate: achievedSlab?.rate ?? null,
      incentive,
    },
    carryOut,
    accumulatedUnpaidBaseOut: 0,
    recognized: thresholdMet,
  };
}

export function calculateMainIncentive(
  actualBase: Money,
  salary: ResolvedSalary,
  config: MainIncentiveConfig,
  state: CalculationState,
): MainCalculationResult {
  return config.structure === 'flat'
    ? calculateFlat(actualBase, salary, config.flat, state)
    : calculateSlab(actualBase, salary, config.slab, state);
}
