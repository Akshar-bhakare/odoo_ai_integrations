import { describe, expect, it } from 'vitest';
import { calculateIncentives } from './engine';
import { resolveSalaryForMonth } from './salary';
import { createInitialCalculationState } from './state';
import { makeInput, makePreset, monthWithBase, newCustomerEvent, repeatCustomerEvent } from './test-helpers';
import type { IncentivePresetV1 } from './types';
import { IncentiveValidationError } from './validation';

describe('Salary policy and engine validation', () => {
  it('uses the salary effective on the first day and does not prorate', () => {
    const salaryHistory = [
      { id: 'aug-1', employeeId: 1, effectiveFrom: '2026-08-01', monthlyWage: 20000 },
      { id: 'aug-15', employeeId: 1, effectiveFrom: '2026-08-15', monthlyWage: 25000 },
    ];
    const policy = makePreset().salaryPolicy;

    expect(resolveSalaryForMonth('2026-08', salaryHistory, policy)).toEqual({
      versionId: 'aug-1',
      monthlyWage: 20000,
    });
    expect(resolveSalaryForMonth('2026-09', salaryHistory, policy)).toEqual({
      versionId: 'aug-15',
      monthlyWage: 25000,
    });
  });

  it('derives thresholds from supplied salary instead of hard-coding test wage', () => {
    const result = calculateIncentives(makeInput({
      salaryHistory: [{ id: 'salary', employeeId: 1, effectiveFrom: '2025-01-01', monthlyWage: 10000 }],
      months: [monthWithBase('2026-01', 60000)],
    }));

    expect(result.months[0].mainIncentive.flatThreshold).toBe(60000);
    expect(result.months[0].mainIncentive.incentive).toBe(6000);
  });

  it('fails when no salary is effective at month start', () => {
    expect(() => calculateIncentives(makeInput({
      salaryHistory: [{ id: 'late', employeeId: 1, effectiveFrom: '2026-01-02', monthlyWage: 20000 }],
    }))).toThrow(IncentiveValidationError);
  });

  it('requires ordered gap-free calendar months', () => {
    expect(() => calculateIncentives(makeInput({
      months: [monthWithBase('2026-01', 0), monthWithBase('2026-03', 0)],
    }))).toThrow('Input months must be ordered, unique, and gap-free');
  });

  it('rejects duplicate and unordered slab thresholds', () => {
    const preset = makePreset();
    preset.mainIncentive = {
      structure: 'slab',
      flat: null,
      slab: {
        thresholdType: 'fixed_amount',
        carryForwardEnabled: true,
        slabApplication: 'whole_eligible_base',
        slabs: [
          { minimumBase: 150000, rate: 0.1 },
          { minimumBase: 120000, rate: 0.125 },
        ],
      },
    };

    expect(() => calculateIncentives(makeInput({ preset }))).toThrow(
      'Slab thresholds must be unique and strictly increasing',
    );
  });

  it('rejects progressive slab configuration at runtime', () => {
    const preset = makePreset() as IncentivePresetV1;
    preset.mainIncentive = {
      structure: 'slab',
      flat: null,
      slab: {
        thresholdType: 'fixed_amount',
        carryForwardEnabled: true,
        slabApplication: 'progressive',
        slabs: [{ minimumBase: 120000, rate: 0.1 }],
      },
    } as unknown as IncentivePresetV1['mainIncentive'];

    expect(() => calculateIncentives(makeInput({ preset }))).toThrow(
      'V1 supports whole eligible base slabs only',
    );
  });

  it('rejects repeat events without their global new-customer event', () => {
    expect(() => calculateIncentives(makeInput({
      customerEvents: [repeatCustomerEvent({
        id: 'repeat',
        customerId: 1,
        newCustomerEventId: 'missing',
        eventDate: '2026-01-10',
      })],
    }))).toThrow('has no referenced new-customer event');
  });

  it('rejects duplicate global new-customer records for one customer', () => {
    expect(() => calculateIncentives(makeInput({
      customerEvents: [
        newCustomerEvent({ id: 'new-1', customerId: 1 }),
        newCustomerEvent({ id: 'new-2', customerId: 1 }),
      ],
    }))).toThrow('has multiple new-customer events');
  });

  it('continues from a checkpoint with identical results to full replay', () => {
    const january = calculateIncentives(makeInput({
      months: [monthWithBase('2026-01', 80000)],
    }));
    const february = calculateIncentives(makeInput({
      months: [monthWithBase('2026-02', 160000)],
      initialState: january.finalState,
    }));
    const fullReplay = calculateIncentives(makeInput({
      months: [monthWithBase('2026-01', 80000), monthWithBase('2026-02', 160000)],
    }));

    expect(february.months[0].mainIncentive).toEqual(fullReplay.months[1].mainIncentive);
    expect(february.finalState).toEqual(fullReplay.finalState);
  });

  it('is deterministic and does not mutate inputs or initial state', () => {
    const state = createInitialCalculationState();
    const input = makeInput({ initialState: state });
    const snapshot = structuredClone(input);

    const first = calculateIncentives(input);
    const second = calculateIncentives(input);

    expect(first).toEqual(second);
    expect(input).toEqual(snapshot);
    expect(state).toEqual(createInitialCalculationState());
  });

  it('returns an unchanged cloned checkpoint for an empty month list', () => {
    const state = createInitialCalculationState();
    state.lastProcessedMonth = '2026-01';
    state.carryShortfall = 40000;
    const result = calculateIncentives(makeInput({ months: [], initialState: state }));

    expect(result.months).toEqual([]);
    expect(result.finalState).toEqual(state);
    expect(result.finalState).not.toBe(state);
  });
});
