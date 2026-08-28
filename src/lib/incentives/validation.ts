import { assertCalendarMonth, assertIsoDate, monthOf, nextMonth } from './dates';
import type {
  CalculationState,
  IncentiveEngineInput,
  IncentivePresetV1,
  NormalizedCustomerEvent,
  SlabIncentiveConfig,
} from './types';

export class IncentiveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncentiveValidationError';
  }
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new IncentiveValidationError(`${label} must be finite`);
  }
}

function requireNonNegative(value: number, label: string): void {
  requireFinite(value, label);
  if (value < 0) {
    throw new IncentiveValidationError(`${label} must not be negative`);
  }
}

function requireRate(value: number, label: string): void {
  requireFinite(value, label);
  if (value < 0 || value > 1) {
    throw new IncentiveValidationError(`${label} must be between 0 and 1`);
  }
}

function validateSlabs(config: SlabIncentiveConfig): void {
  if (config.slabApplication !== 'whole_eligible_base') {
    throw new IncentiveValidationError('V1 supports whole eligible base slabs only');
  }
  if (config.slabs.length === 0) {
    throw new IncentiveValidationError('At least one slab is required');
  }

  const thresholds = config.thresholdType === 'fixed_amount'
    ? config.slabs.map((slab, index) => {
        requireNonNegative(slab.minimumBase, `slab ${index + 1} threshold`);
        requireRate(slab.rate, `slab ${index + 1} rate`);
        return slab.minimumBase;
      })
    : config.slabs.map((slab, index) => {
        requireFinite(slab.minimumMultiplier, `slab ${index + 1} threshold`);
        if (slab.minimumMultiplier <= 0) {
          throw new IncentiveValidationError(`slab ${index + 1} threshold is invalid`);
        }
        requireRate(slab.rate, `slab ${index + 1} rate`);
        return slab.minimumMultiplier;
      });

  for (let index = 1; index < thresholds.length; index += 1) {
    if (thresholds[index] <= thresholds[index - 1]) {
      throw new IncentiveValidationError('Slab thresholds must be unique and strictly increasing');
    }
  }
}

export function validatePreset(preset: IncentivePresetV1): void {
  if (preset.schemaVersion !== '1.0') {
    throw new IncentiveValidationError(`Unsupported preset schema: ${preset.schemaVersion}`);
  }
  if (preset.salaryPolicy.effectiveDateBasis !== 'first_day_of_calendar_month') {
    throw new IncentiveValidationError('V1 salary must be selected on the first day of the month');
  }
  if (preset.salaryPolicy.proration !== 'none') {
    throw new IncentiveValidationError('V1 does not support salary proration');
  }
  if (preset.mainIncentive.structure === 'flat') {
    if (preset.mainIncentive.slab !== null || preset.mainIncentive.flat === null) {
      throw new IncentiveValidationError('Flat and Slab configurations are mutually exclusive');
    }
    const flat = preset.mainIncentive.flat;
    if (flat.threshold.source !== 'salary_multiple' || flat.threshold.salaryMultiplier <= 0) {
      throw new IncentiveValidationError('Flat threshold requires a positive salary multiplier');
    }
    requireRate(flat.rate, 'flat rate');
  } else {
    if (preset.mainIncentive.flat !== null || preset.mainIncentive.slab === null) {
      throw new IncentiveValidationError('Flat and Slab configurations are mutually exclusive');
    }
    validateSlabs(preset.mainIncentive.slab);
  }

  if (preset.newCustomer.qualificationScope !== 'company_global') {
    throw new IncentiveValidationError('V1 supports company-global new-customer qualification only');
  }
  if (!Number.isInteger(preset.newCustomer.minimumQualifyingCustomers)
    || preset.newCustomer.minimumQualifyingCustomers < 0) {
    throw new IncentiveValidationError('Minimum qualifying customers must be a non-negative integer');
  }
  requireNonNegative(preset.newCustomer.minimumBilling, 'new-customer minimum billing');
  requireNonNegative(preset.newCustomer.bonusPerCustomer, 'new-customer bonus');
  if (preset.newCustomer.minimumGmAmount !== null) {
    requireFinite(preset.newCustomer.minimumGmAmount, 'new-customer minimum GM');
  }
  if (preset.newCustomer.minimumGmPercent !== null) {
    requireFinite(preset.newCustomer.minimumGmPercent, 'new-customer minimum GM percent');
  }

  if (!Number.isInteger(preset.repeatCustomer.repeatWindowDays)
    || preset.repeatCustomer.repeatWindowDays < 1) {
    throw new IncentiveValidationError('Repeat window must be a positive integer');
  }
  if (preset.repeatCustomer.maximumPayoutsPerCustomer !== null
    && (!Number.isInteger(preset.repeatCustomer.maximumPayoutsPerCustomer)
      || preset.repeatCustomer.maximumPayoutsPerCustomer < 1)) {
    throw new IncentiveValidationError('Repeat maximum payouts must be null or a positive integer');
  }
  requireNonNegative(preset.repeatCustomer.bonusPerCustomer, 'repeat-customer bonus');
  if (preset.repeatCustomer.minimumBilling !== null) {
    requireNonNegative(preset.repeatCustomer.minimumBilling, 'repeat minimum billing');
  }
  if (preset.repeatCustomer.minimumGmAmount !== null) {
    requireFinite(preset.repeatCustomer.minimumGmAmount, 'repeat minimum GM');
  }
  if (preset.repeatCustomer.minimumGmPercent !== null) {
    requireFinite(preset.repeatCustomer.minimumGmPercent, 'repeat minimum GM percent');
  }

  if (!Number.isInteger(preset.performanceNotice.consecutiveFailedMonths)
    || preset.performanceNotice.consecutiveFailedMonths < 1) {
    throw new IncentiveValidationError('Performance notice months must be a positive integer');
  }
}

function validateCustomerEvent(event: NormalizedCustomerEvent): void {
  if (!event.id.trim()) {
    throw new IncentiveValidationError('Customer event ID is required');
  }
  assertIsoDate(event.eventDate);
  requireFinite(event.billing, `customer event ${event.id} billing`);
  requireFinite(event.grossMargin, `customer event ${event.id} gross margin`);
  if (event.ownership.status === 'resolved' && !Number.isInteger(event.ownership.employeeId)) {
    throw new IncentiveValidationError(`Customer event ${event.id} has an invalid employee owner`);
  }
}

function validateState(state: CalculationState): void {
  if (state.lastProcessedMonth !== null) {
    assertCalendarMonth(state.lastProcessedMonth);
  }
  requireNonNegative(state.carryShortfall, 'state carry shortfall');
  requireFinite(state.accumulatedUnpaidBase, 'state accumulated unpaid base');
  if (!Number.isInteger(state.consecutiveFailureCount) || state.consecutiveFailureCount < 0) {
    throw new IncentiveValidationError('State failure count must be a non-negative integer');
  }
  if (!Number.isInteger(state.cycleSequence) || state.cycleSequence < 0) {
    throw new IncentiveValidationError('State cycle sequence must be a non-negative integer');
  }
  if (new Set(state.recognizedCustomerEventIds).size !== state.recognizedCustomerEventIds.length) {
    throw new IncentiveValidationError('Recognized customer event IDs must be unique');
  }
  for (const [customerId, count] of Object.entries(state.repeatPayoutCountsByCustomer)) {
    if (!customerId || !Number.isInteger(count) || count < 0) {
      throw new IncentiveValidationError('Repeat payout state is invalid');
    }
  }
}

export function validateEngineInput(input: IncentiveEngineInput): void {
  validatePreset(input.preset);
  if (!Number.isInteger(input.employeeId) || !Number.isInteger(input.companyId)) {
    throw new IncentiveValidationError('Employee and company IDs must be integers');
  }

  let previousMonth: string | null = input.initialState?.lastProcessedMonth ?? null;
  for (const normalizedMonth of input.months) {
    assertCalendarMonth(normalizedMonth.month);
    if (previousMonth !== null && normalizedMonth.month !== nextMonth(previousMonth)) {
      throw new IncentiveValidationError('Input months must be ordered, unique, and gap-free');
    }
    previousMonth = normalizedMonth.month;
    for (const [field, value] of Object.entries(normalizedMonth.accounting)) {
      requireFinite(value, `${normalizedMonth.month} accounting.${field}`);
    }
  }

  const salaryDates = new Set<string>();
  for (const salary of input.salaryHistory) {
    assertIsoDate(salary.effectiveFrom);
    if (salary.employeeId !== input.employeeId) {
      throw new IncentiveValidationError('Salary history contains a different employee');
    }
    requireNonNegative(salary.monthlyWage, `salary ${salary.id}`);
    if (salaryDates.has(salary.effectiveFrom)) {
      throw new IncentiveValidationError('Salary versions cannot share an effective date');
    }
    salaryDates.add(salary.effectiveFrom);
  }

  const eventIds = new Set<string>();
  const newCustomerEventIds = new Set<string>();
  const newCustomerIds = new Set<number>();
  for (const event of input.customerEvents) {
    validateCustomerEvent(event);
    if (eventIds.has(event.id)) {
      throw new IncentiveValidationError(`Duplicate customer event ID: ${event.id}`);
    }
    eventIds.add(event.id);
    if (event.kind === 'new_customer') {
      if (newCustomerIds.has(event.customerId)) {
        throw new IncentiveValidationError(`Customer ${event.customerId} has multiple new-customer events`);
      }
      newCustomerIds.add(event.customerId);
      newCustomerEventIds.add(event.id);
    }
  }
  for (const event of input.customerEvents) {
    if (event.kind === 'repeat_customer' && !newCustomerEventIds.has(event.newCustomerEventId)) {
      throw new IncentiveValidationError(`Repeat event ${event.id} has no referenced new-customer event`);
    }
  }

  for (const adjustment of input.adjustments) {
    assertCalendarMonth(adjustment.month);
    if (adjustment.employeeId !== input.employeeId) {
      throw new IncentiveValidationError('Adjustment contains a different employee');
    }
    requireNonNegative(adjustment.amount, `adjustment ${adjustment.id}`);
    if (!adjustment.reason.trim()) {
      throw new IncentiveValidationError(`Adjustment ${adjustment.id} requires a reason`);
    }
  }

  if (input.initialState) {
    validateState(input.initialState);
  }

  const inputMonths = new Set(input.months.map((month) => month.month));
  for (const adjustment of input.adjustments) {
    if (!inputMonths.has(adjustment.month)) {
      throw new IncentiveValidationError(`Adjustment ${adjustment.id} is outside the calculation months`);
    }
  }
  for (const event of input.customerEvents) {
    monthOf(event.eventDate);
  }
}
