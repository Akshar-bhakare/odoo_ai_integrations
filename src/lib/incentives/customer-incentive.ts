import { daysBetween, monthOf } from './dates';
import { roundMoney, sumMoney } from './money';
import { cloneCalculationState } from './state';
import type {
  CalculationState,
  CalendarMonth,
  CustomerIncentiveCalculation,
  IncentivePresetV1,
  NormalizedCustomerEvent,
  NormalizedNewCustomerEvent,
  NormalizedRepeatCustomerEvent,
  ResolutionIssue,
} from './types';

interface CustomerMonthResult {
  calculation: CustomerIncentiveCalculation;
  issues: ResolutionIssue[];
  state: CalculationState;
}

function grossMarginPercent(billing: number, grossMargin: number): number {
  return billing === 0 ? 0 : (grossMargin / billing) * 100;
}

export function qualifiesAsNewCustomer(
  event: NormalizedNewCustomerEvent,
  config: IncentivePresetV1['newCustomer'],
): boolean {
  const billing = roundMoney(event.billing);
  const grossMargin = roundMoney(event.grossMargin);
  const billingPasses = config.billingComparison === 'gt'
    ? billing > config.minimumBilling
    : billing >= config.minimumBilling;
  const amountPasses = config.minimumGmAmount === null
    || grossMargin >= config.minimumGmAmount;
  const percentPasses = config.minimumGmPercent === null
    || grossMarginPercent(billing, grossMargin) >= config.minimumGmPercent;
  return billingPasses && amountPasses && percentPasses;
}

function qualifiesAsRepeatCustomer(
  event: NormalizedRepeatCustomerEvent,
  newEvent: NormalizedNewCustomerEvent,
  newCustomerQualified: boolean,
  config: IncentivePresetV1['repeatCustomer'],
): boolean {
  if (config.requiresQualifiedNewCustomer && !newCustomerQualified) {
    return false;
  }

  const elapsedDays = daysBetween(newEvent.eventDate, event.eventDate);
  if (elapsedDays <= 0 || elapsedDays > config.repeatWindowDays) {
    return false;
  }

  const billing = roundMoney(event.billing);
  const grossMargin = roundMoney(event.grossMargin);
  return (config.minimumBilling === null || billing >= config.minimumBilling)
    && (config.minimumGmAmount === null || grossMargin >= config.minimumGmAmount)
    && (config.minimumGmPercent === null
      || grossMarginPercent(billing, grossMargin) >= config.minimumGmPercent);
}

function pendingOwnerIssue(event: NormalizedCustomerEvent): ResolutionIssue {
  return {
    type: 'customer_owner',
    eventId: event.id,
    customerId: event.customerId,
    message: `Customer event ${event.id} has no resolved incentive owner`,
  };
}

function pendingEventCanBelongToEmployee(
  event: NormalizedCustomerEvent,
  employeeId: number,
): boolean {
  // Odoo-normalized events explicitly use null when no salesperson can be
  // attributed. Such a company-wide unknown must remain in the unresolved
  // workspace, but it cannot block an unrelated employee calculation.
  return event.billingEmployeeId === undefined || event.billingEmployeeId === employeeId;
}

export function calculateCustomerIncentivesForMonth(params: {
  month: CalendarMonth;
  employeeId: number;
  customerEvents: NormalizedCustomerEvent[];
  newEventsById: Map<string, NormalizedNewCustomerEvent>;
  newQualificationById: Map<string, boolean>;
  preset: IncentivePresetV1;
  state: CalculationState;
}): CustomerMonthResult {
  const {
    month,
    employeeId,
    customerEvents,
    newEventsById,
    newQualificationById,
    preset,
  } = params;
  const state = cloneCalculationState(params.state);
  const recognizedEventIds = new Set(state.recognizedCustomerEventIds);
  const issues: ResolutionIssue[] = [];
  const pendingCustomerEventIds: string[] = [];
  const qualifiedNewCustomerEventIds: string[] = [];
  const paidNewCustomerEventIds: string[] = [];
  const qualifiedRepeatCustomerEventIds: string[] = [];
  const paidRepeatCustomerEventIds: string[] = [];

  const newEvents = customerEvents
    .filter((event): event is NormalizedNewCustomerEvent => (
      event.kind === 'new_customer' && monthOf(event.eventDate) === month
    ))
    .sort((left, right) => left.eventDate.localeCompare(right.eventDate) || left.id.localeCompare(right.id));
  const qualifyingNewEvents = newEvents.filter((event) => newQualificationById.get(event.id));
  const employeeQualifyingNewEvents = qualifyingNewEvents.filter((event) => (
    event.ownership.status === 'resolved' && event.ownership.employeeId === employeeId
  ));

  for (const event of qualifyingNewEvents) {
    if (event.ownership.status === 'resolved' && event.ownership.employeeId === employeeId) {
      qualifiedNewCustomerEventIds.push(event.id);
    }
    if (preset.newCustomer.enabled && event.ownership.status === 'pending'
      && pendingEventCanBelongToEmployee(event, employeeId)) {
      pendingCustomerEventIds.push(event.id);
      issues.push(pendingOwnerIssue(event));
    }
  }

  if (preset.newCustomer.enabled) {
    if (employeeQualifyingNewEvents.length >= preset.newCustomer.minimumQualifyingCustomers) {
      for (const event of employeeQualifyingNewEvents) {
        if (recognizedEventIds.has(event.id)) {
          continue;
        }
        recognizedEventIds.add(event.id);
        paidNewCustomerEventIds.push(event.id);
      }
    }
  }

  if (preset.repeatCustomer.enabled) {
    const repeatEvents = customerEvents
      .filter((event): event is NormalizedRepeatCustomerEvent => (
        event.kind === 'repeat_customer' && monthOf(event.eventDate) === month
      ))
      .sort((left, right) => left.eventDate.localeCompare(right.eventDate) || left.id.localeCompare(right.id));

    for (const event of repeatEvents) {
      const newEvent = newEventsById.get(event.newCustomerEventId);
      if (!newEvent || !qualifiesAsRepeatCustomer(
        event,
        newEvent,
        newQualificationById.get(newEvent.id) ?? false,
        preset.repeatCustomer,
      )) {
        continue;
      }

      if (event.ownership.status === 'pending') {
        if (!pendingEventCanBelongToEmployee(event, employeeId)) {
          continue;
        }
        pendingCustomerEventIds.push(event.id);
        issues.push(pendingOwnerIssue(event));
        continue;
      }
      if (event.ownership.employeeId !== employeeId) {
        continue;
      }
      qualifiedRepeatCustomerEventIds.push(event.id);
      if (recognizedEventIds.has(event.id)) {
        continue;
      }

      const customerKey = String(event.customerId);
      const existingPayoutCount = state.repeatPayoutCountsByCustomer[customerKey] ?? 0;
      const maximumPayouts = preset.repeatCustomer.maximumPayoutsPerCustomer;
      if (maximumPayouts !== null && existingPayoutCount >= maximumPayouts) {
        continue;
      }

      recognizedEventIds.add(event.id);
      state.repeatPayoutCountsByCustomer[customerKey] = existingPayoutCount + 1;
      paidRepeatCustomerEventIds.push(event.id);
    }
  }

  state.recognizedCustomerEventIds = [...recognizedEventIds].sort();
  return {
    calculation: {
      qualifiedNewCustomerEventIds,
      paidNewCustomerEventIds,
      qualifiedRepeatCustomerEventIds,
      paidRepeatCustomerEventIds,
      pendingCustomerEventIds,
      newCustomerBonus: sumMoney(
        paidNewCustomerEventIds.map(() => preset.newCustomer.bonusPerCustomer),
      ),
      repeatCustomerBonus: sumMoney(
        paidRepeatCustomerEventIds.map(() => preset.repeatCustomer.bonusPerCustomer),
      ),
    },
    issues,
    state,
  };
}
