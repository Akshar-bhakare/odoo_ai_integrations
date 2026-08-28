import { describe, expect, it } from 'vitest';
import { calculateIncentives } from './engine';
import { qualifiesAsNewCustomer } from './customer-incentive';
import {
  makeInput,
  makePreset,
  monthWithBase,
  newCustomerEvent,
  repeatCustomerEvent,
} from './test-helpers';
import type { NormalizedNewCustomerEvent } from './types';

function newCustomerEventsByOwner(ownerCounts: Array<[number, number]>) {
  let customerId = 1;
  return ownerCounts.flatMap(([ownerEmployeeId, count]) => Array.from({ length: count }, () => {
    const id = `new-${customerId}`;
    const event = newCustomerEvent({ id, customerId, ownerEmployeeId });
    customerId += 1;
    return event;
  }));
}

function newCustomerBonusForEmployee(
  employeeId: number,
  customerEvents: ReturnType<typeof newCustomerEventsByOwner>,
): number {
  const preset = makePreset();
  preset.newCustomer.minimumQualifyingCustomers = 3;
  const input = makeInput({ employeeId, preset, customerEvents });
  input.salaryHistory = input.salaryHistory.map((salary) => ({ ...salary, employeeId }));
  return calculateIncentives(input)
    .months[0].customerIncentive.newCustomerBonus;
}

describe('Customer incentives', () => {
  it('requires strict billing greater than 100,000 in the initial preset', () => {
    const preset = makePreset();
    const atBoundary = newCustomerEvent({ id: 'new-1', customerId: 1, billing: 100000 });
    const aboveBoundary = newCustomerEvent({ id: 'new-2', customerId: 2, billing: 100000.01 });

    expect(qualifiesAsNewCustomer(atBoundary as NormalizedNewCustomerEvent, preset.newCustomer)).toBe(false);
    expect(qualifiesAsNewCustomer(aboveBoundary as NormalizedNewCustomerEvent, preset.newCustomer)).toBe(true);
  });

  it('checks configurable GM amount and percentage conditions', () => {
    const preset = makePreset();
    preset.newCustomer.minimumGmAmount = 5000;
    preset.newCustomer.minimumGmPercent = 5;
    const lowAmount = newCustomerEvent({ id: 'new-1', customerId: 1, billing: 200000, grossMargin: 4999 });
    const lowPercent = newCustomerEvent({ id: 'new-2', customerId: 2, billing: 200000, grossMargin: 5000 });
    const passing = newCustomerEvent({ id: 'new-3', customerId: 3, billing: 200000, grossMargin: 10000 });

    expect(qualifiesAsNewCustomer(lowAmount as NormalizedNewCustomerEvent, preset.newCustomer)).toBe(false);
    expect(qualifiesAsNewCustomer(lowPercent as NormalizedNewCustomerEvent, preset.newCustomer)).toBe(false);
    expect(qualifiesAsNewCustomer(passing as NormalizedNewCustomerEvent, preset.newCustomer)).toBe(true);
  });

  it('uses globally aggregated customer values without adding them to Actual Base', () => {
    const preset = makePreset();
    preset.newCustomer.minimumQualifyingCustomers = 1;
    const event = newCustomerEvent({
      id: 'global-new',
      customerId: 1,
      billing: 130000,
      grossMargin: 10000,
    });

    const result = calculateIncentives(makeInput({
      preset,
      months: [monthWithBase('2026-01', 0)],
      customerEvents: [event],
    }));

    expect(result.months[0].accounting.actualBase).toBe(0);
    expect(result.months[0].customerIncentive.paidNewCustomerEventIds).toEqual(['global-new']);
    expect(result.months[0].customerIncentive.newCustomerBonus).toBe(2000);
  });

  it('pays all qualifying owned customers only after the monthly count is met', () => {
    const preset = makePreset();
    const events = [
      newCustomerEvent({ id: 'new-1', customerId: 1 }),
      newCustomerEvent({ id: 'new-2', customerId: 2 }),
      newCustomerEvent({ id: 'new-3', customerId: 3 }),
    ];

    const passing = calculateIncentives(makeInput({ preset, customerEvents: events }));
    const failing = calculateIncentives(makeInput({ preset, customerEvents: events.slice(0, 2) }));

    expect(passing.months[0].customerIncentive.newCustomerBonus).toBe(6000);
    expect(passing.months[0].customerIncentive.paidNewCustomerEventIds).toHaveLength(3);
    expect(failing.months[0].customerIncentive.newCustomerBonus).toBe(0);
  });

  it('pays neither employee when globally qualifying customers split 2/1', () => {
    const events = newCustomerEventsByOwner([[1, 2], [2, 1]]);

    expect(newCustomerBonusForEmployee(1, events)).toBe(0);
    expect(newCustomerBonusForEmployee(2, events)).toBe(0);
  });

  it('pays only the employee meeting the minimum when customers split 3/1', () => {
    const events = newCustomerEventsByOwner([[1, 3], [2, 1]]);

    expect(newCustomerBonusForEmployee(1, events)).toBe(6000);
    expect(newCustomerBonusForEmployee(2, events)).toBe(0);
  });

  it('pays both employees when globally qualifying customers split 3/3', () => {
    const events = newCustomerEventsByOwner([[1, 3], [2, 3]]);

    expect(newCustomerBonusForEmployee(1, events)).toBe(6000);
    expect(newCustomerBonusForEmployee(2, events)).toBe(6000);
  });

  it('pays only the employee meeting the minimum when customers split 4/2', () => {
    const events = newCustomerEventsByOwner([[1, 4], [2, 2]]);

    expect(newCustomerBonusForEmployee(1, events)).toBe(8000);
    expect(newCustomerBonusForEmployee(2, events)).toBe(0);
  });

  it('leaves a qualifying customer bonus pending when ownership is unresolved', () => {
    const preset = makePreset();
    preset.newCustomer.minimumQualifyingCustomers = 1;
    const result = calculateIncentives(makeInput({
      preset,
      customerEvents: [newCustomerEvent({ id: 'pending-new', customerId: 1, pending: true })],
    }));

    expect(result.months[0].customerIncentive.newCustomerBonus).toBe(0);
    expect(result.months[0].customerIncentive.pendingCustomerEventIds).toEqual(['pending-new']);
    expect(result.resolutionIssues).toHaveLength(1);
  });

  it('does not let an explicitly unattributed company event block an employee', () => {
    const preset = makePreset();
    preset.newCustomer.minimumQualifyingCustomers = 1;
    const event = newCustomerEvent({ id: 'company-unattributed', customerId: 1, pending: true });
    event.billingEmployeeId = null;
    const result = calculateIncentives(makeInput({ preset, customerEvents: [event] }));

    expect(result.months[0].customerIncentive.newCustomerBonus).toBe(0);
    expect(result.months[0].customerIncentive.pendingCustomerEventIds).toEqual([]);
    expect(result.resolutionIssues).toEqual([]);
  });

  it('supports new-customer OFF and repeat ON independently', () => {
    const preset = makePreset();
    preset.newCustomer.enabled = false;
    const events = [
      newCustomerEvent({ id: 'new-1', customerId: 1, eventDate: '2026-01-01' }),
      repeatCustomerEvent({
        id: 'repeat-1',
        customerId: 1,
        newCustomerEventId: 'new-1',
        eventDate: '2026-01-31',
      }),
    ];

    const result = calculateIncentives(makeInput({ preset, customerEvents: events }));

    expect(result.months[0].customerIncentive.newCustomerBonus).toBe(0);
    expect(result.months[0].customerIncentive.repeatCustomerBonus).toBe(2000);
  });

  it('supports new-customer ON and repeat OFF independently', () => {
    const preset = makePreset();
    preset.newCustomer.minimumQualifyingCustomers = 1;
    preset.repeatCustomer.enabled = false;
    const events = [
      newCustomerEvent({ id: 'new-1', customerId: 1, eventDate: '2026-01-01' }),
      repeatCustomerEvent({
        id: 'repeat-1',
        customerId: 1,
        newCustomerEventId: 'new-1',
        eventDate: '2026-01-31',
      }),
    ];

    const result = calculateIncentives(makeInput({ preset, customerEvents: events }));

    expect(result.months[0].customerIncentive.newCustomerBonus).toBe(2000);
    expect(result.months[0].customerIncentive.repeatCustomerBonus).toBe(0);
  });

  it('qualifies repeat day 90 and rejects day 91', () => {
    const preset = makePreset();
    preset.newCustomer.enabled = false;
    preset.repeatCustomer.maximumPayoutsPerCustomer = null;
    const events = [
      newCustomerEvent({ id: 'new-1', customerId: 1, eventDate: '2026-01-01' }),
      repeatCustomerEvent({ id: 'day-90', customerId: 1, newCustomerEventId: 'new-1', eventDate: '2026-04-01' }),
      repeatCustomerEvent({ id: 'day-91', customerId: 1, newCustomerEventId: 'new-1', eventDate: '2026-04-02' }),
    ];

    const result = calculateIncentives(makeInput({
      preset,
      months: [monthWithBase('2026-04', 0)],
      customerEvents: events,
    }));

    expect(result.months[0].customerIncentive.qualifiedRepeatCustomerEventIds).toEqual(['day-90']);
    expect(result.months[0].customerIncentive.repeatCustomerBonus).toBe(2000);
  });

  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [null, 3],
  ] as const)('enforces repeat maximum %s', (maximumPayouts, expectedPayouts) => {
    const preset = makePreset();
    preset.newCustomer.enabled = false;
    preset.repeatCustomer.maximumPayoutsPerCustomer = maximumPayouts;
    const events = [
      newCustomerEvent({ id: 'new-1', customerId: 1, eventDate: '2026-01-01' }),
      repeatCustomerEvent({ id: 'repeat-1', customerId: 1, newCustomerEventId: 'new-1', eventDate: '2026-01-11' }),
      repeatCustomerEvent({ id: 'repeat-2', customerId: 1, newCustomerEventId: 'new-1', eventDate: '2026-01-21' }),
      repeatCustomerEvent({ id: 'repeat-3', customerId: 1, newCustomerEventId: 'new-1', eventDate: '2026-01-31' }),
    ];

    const result = calculateIncentives(makeInput({ preset, customerEvents: events }));

    expect(result.months[0].customerIncentive.paidRepeatCustomerEventIds).toHaveLength(expectedPayouts);
    expect(result.months[0].customerIncentive.repeatCustomerBonus).toBe(expectedPayouts * 2000);
  });

  it('applies repeat billing and GM conditions', () => {
    const preset = makePreset();
    preset.newCustomer.enabled = false;
    preset.repeatCustomer.minimumBilling = 50000;
    preset.repeatCustomer.minimumGmAmount = 5000;
    preset.repeatCustomer.minimumGmPercent = 10;
    preset.repeatCustomer.maximumPayoutsPerCustomer = null;
    const events = [
      newCustomerEvent({ id: 'new-1', customerId: 1, eventDate: '2026-01-01' }),
      repeatCustomerEvent({ id: 'low-billing', customerId: 1, newCustomerEventId: 'new-1', eventDate: '2026-01-10', billing: 49999, grossMargin: 10000 }),
      repeatCustomerEvent({ id: 'low-gm', customerId: 1, newCustomerEventId: 'new-1', eventDate: '2026-01-20', billing: 50000, grossMargin: 4999 }),
      repeatCustomerEvent({ id: 'passing', customerId: 1, newCustomerEventId: 'new-1', eventDate: '2026-01-30', billing: 50000, grossMargin: 5000 }),
    ];

    const result = calculateIncentives(makeInput({ preset, customerEvents: events }));

    expect(result.months[0].customerIncentive.paidRepeatCustomerEventIds).toEqual(['passing']);
  });

  it('does not let another employee consume this employee repeat payout limit', () => {
    const preset = makePreset();
    preset.newCustomer.enabled = false;
    preset.repeatCustomer.maximumPayoutsPerCustomer = 1;
    const events = [
      newCustomerEvent({ id: 'new-1', customerId: 1, eventDate: '2026-01-01', ownerEmployeeId: 1 }),
      repeatCustomerEvent({ id: 'owner-2', customerId: 1, newCustomerEventId: 'new-1', eventDate: '2026-01-10', ownerEmployeeId: 2 }),
      repeatCustomerEvent({ id: 'owner-1', customerId: 1, newCustomerEventId: 'new-1', eventDate: '2026-01-20', ownerEmployeeId: 1 }),
    ];

    const result = calculateIncentives(makeInput({ preset, customerEvents: events }));

    expect(result.months[0].customerIncentive.repeatCustomerBonus).toBe(2000);
    expect(result.finalState.repeatPayoutCountsByCustomer['1']).toBe(1);
    expect(result.finalState.recognizedCustomerEventIds).not.toContain('owner-2');
    expect(result.finalState.recognizedCustomerEventIds).toContain('owner-1');
  });

  it('does not guess a pending repeat owner or consume its payout', () => {
    const preset = makePreset();
    preset.newCustomer.enabled = false;
    const events = [
      newCustomerEvent({ id: 'new-1', customerId: 1, eventDate: '2026-01-01' }),
      repeatCustomerEvent({ id: 'pending-repeat', customerId: 1, newCustomerEventId: 'new-1', eventDate: '2026-01-20', pending: true }),
    ];

    const result = calculateIncentives(makeInput({ preset, customerEvents: events }));

    expect(result.months[0].customerIncentive.repeatCustomerBonus).toBe(0);
    expect(result.months[0].customerIncentive.pendingCustomerEventIds).toEqual(['pending-repeat']);
    expect(result.finalState.repeatPayoutCountsByCustomer['1']).toBeUndefined();
  });
});
