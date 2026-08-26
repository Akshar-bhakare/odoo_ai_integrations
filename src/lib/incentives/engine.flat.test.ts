import { describe, expect, it } from 'vitest';
import { calculateIncentives } from './engine';
import { accounting, makeInput, makePreset, monthWithBase } from './test-helpers';

describe('Flat incentive calculations', () => {
  it('pays the full accumulated six-lakh base after a three-lakh requirement is met', () => {
    const result = calculateIncentives(makeInput({
      salaryHistory: [{ id: 'salary', employeeId: 1, effectiveFrom: '2025-01-01', monthlyWage: 50000 }],
      months: [monthWithBase('2026-01', 200000), monthWithBase('2026-02', 400000)],
    }));

    expect(result.months[0].mainIncentive.carryOut).toBe(100000);
    expect(result.months[1].mainIncentive.requiredThreshold).toBe(400000);
    expect(result.months[1].mainIncentive.eligibleIncentiveBase).toBe(600000);
    expect(result.months[1].mainIncentive.incentive).toBe(60000);
  });

  it('calculates carry with current-month-only payout', () => {
    const preset = makePreset();
    if (preset.mainIncentive.structure !== 'flat') throw new Error('Expected Flat preset');
    preset.mainIncentive.flat.previousBasePayout = 'current_month_only';

    const result = calculateIncentives(makeInput({
      preset,
      months: [monthWithBase('2026-01', 80000), monthWithBase('2026-02', 160000)],
    }));

    expect(result.months[0].mainIncentive.carryOut).toBe(40000);
    expect(result.months[0].mainIncentive.incentive).toBe(0);
    expect(result.months[1].mainIncentive.requiredThreshold).toBe(160000);
    expect(result.months[1].mainIncentive.eligibleIncentiveBase).toBe(160000);
    expect(result.months[1].mainIncentive.incentive).toBe(16000);
  });

  it('pays prior unpaid base once and resets the recognition cycle', () => {
    const result = calculateIncentives(makeInput({
      months: [
        monthWithBase('2026-01', 80000),
        monthWithBase('2026-02', 160000),
        monthWithBase('2026-03', 120000),
      ],
    }));

    expect(result.months[0].mainIncentive.accumulatedUnpaidBaseOut).toBe(80000);
    expect(result.months[1].mainIncentive.eligibleIncentiveBase).toBe(240000);
    expect(result.months[1].mainIncentive.incentive).toBe(24000);
    expect(result.months[1].mainIncentive.accumulatedUnpaidBaseOut).toBe(0);
    expect(result.months[2].mainIncentive.eligibleIncentiveBase).toBe(120000);
    expect(result.months[2].mainIncentive.incentive).toBe(12000);
    expect(result.finalState.cycleSequence).toBe(2);
  });

  it('pays only the amount above the normal threshold', () => {
    const preset = makePreset();
    if (preset.mainIncentive.structure !== 'flat') throw new Error('Expected Flat preset');
    preset.mainIncentive.flat.payoutBasis = 'above_threshold_only';
    preset.mainIncentive.flat.previousBasePayout = 'current_month_only';
    preset.mainIncentive.flat.carryForwardEnabled = false;

    const result = calculateIncentives(makeInput({
      preset,
      months: [monthWithBase('2026-01', 200000)],
    }));

    expect(result.months[0].mainIncentive.eligibleIncentiveBase).toBe(80000);
    expect(result.months[0].mainIncentive.incentive).toBe(8000);
  });

  it('uses accumulated carry in above-threshold-only mode', () => {
    const preset = makePreset();
    if (preset.mainIncentive.structure !== 'flat') throw new Error('Expected Flat preset');
    preset.mainIncentive.flat.payoutBasis = 'above_threshold_only';
    preset.mainIncentive.flat.previousBasePayout = 'current_month_only';

    const result = calculateIncentives(makeInput({
      preset,
      months: [monthWithBase('2026-01', 80000), monthWithBase('2026-02', 200000)],
    }));

    expect(result.months[1].mainIncentive.requiredThreshold).toBe(160000);
    expect(result.months[1].mainIncentive.eligibleIncentiveBase).toBe(40000);
    expect(result.months[1].mainIncentive.incentive).toBe(4000);
  });

  it('allows a negative Actual Base and increases carry', () => {
    const result = calculateIncentives(makeInput({
      months: [monthWithBase('2026-01', -70000)],
    }));

    expect(result.months[0].accounting.actualBase).toBe(-70000);
    expect(result.months[0].mainIncentive.carryOut).toBe(190000);
  });

  it('does not retain shortfall when carry is disabled', () => {
    const preset = makePreset();
    if (preset.mainIncentive.structure !== 'flat') throw new Error('Expected Flat preset');
    preset.mainIncentive.flat.carryForwardEnabled = false;

    const result = calculateIncentives(makeInput({
      preset,
      months: [monthWithBase('2026-01', 80000), monthWithBase('2026-02', 120000)],
    }));

    expect(result.months[0].mainIncentive.carryOut).toBe(0);
    expect(result.months[1].mainIncentive.requiredThreshold).toBe(120000);
  });

  it('calculates Actual Base from all signed accounting components', () => {
    const result = calculateIncentives(makeInput({
      months: [{
        month: '2026-01',
        accounting: accounting({
          netSales: 300000,
          cogs: 100000,
          transport: 10000,
          loading: 5000,
          signedAccountingAdjustments: -20000,
          employeeExpenses: 15000,
          commission: 10000,
        }),
      }],
    }));

    expect(result.months[0].accounting.grossMargin).toBe(200000);
    expect(result.months[0].accounting.adjustedGrossMargin).toBe(165000);
    expect(result.months[0].accounting.actualBase).toBe(140000);
  });

  it('honors expense and commission deduction switches', () => {
    const preset = makePreset();
    preset.base.deductEmployeeExpenses = false;
    preset.base.deductCommission = false;

    const result = calculateIncentives(makeInput({
      preset,
      months: [{
        month: '2026-01',
        accounting: accounting({ netSales: 150000, employeeExpenses: 20000, commission: 10000 }),
      }],
    }));

    expect(result.months[0].accounting.employeeExpenses).toBe(0);
    expect(result.months[0].accounting.commission).toBe(0);
    expect(result.months[0].accounting.actualBase).toBe(150000);
  });

  it('applies additions and deductions without changing raw incentive', () => {
    const result = calculateIncentives(makeInput({
      adjustments: [
        { id: 'add', employeeId: 1, month: '2026-01', operation: 'add', amount: 5000, reason: 'Special performance' },
        { id: 'deduct', employeeId: 1, month: '2026-01', operation: 'deduct', amount: 2000, reason: 'Recovery' },
      ],
    }));

    expect(result.months[0].calculatedIncentive).toBe(12000);
    expect(result.months[0].adjustmentTotal).toBe(3000);
    expect(result.months[0].finalIncentive).toBe(15000);
  });

  it('triggers a notice after four consecutive failures and resets after success', () => {
    const result = calculateIncentives(makeInput({
      months: [
        monthWithBase('2026-01', 0),
        monthWithBase('2026-02', 0),
        monthWithBase('2026-03', 0),
        monthWithBase('2026-04', 0),
        monthWithBase('2026-05', 1000000),
      ],
    }));

    expect(result.months.slice(0, 3).every((month) => !month.performanceNoticeTriggered)).toBe(true);
    expect(result.months[3].performanceNoticeTriggered).toBe(true);
    expect(result.months[4].performanceNoticeTriggered).toBe(false);
    expect(result.finalState.consecutiveFailureCount).toBe(0);
  });

  it('rounds monetary results deterministically to paise', () => {
    const preset = makePreset();
    if (preset.mainIncentive.structure !== 'flat') throw new Error('Expected Flat preset');
    preset.mainIncentive.flat.carryForwardEnabled = false;
    preset.mainIncentive.flat.threshold.salaryMultiplier = 1;
    preset.mainIncentive.flat.rate = 0.125;

    const result = calculateIncentives(makeInput({
      preset,
      salaryHistory: [{ id: 1, employeeId: 1, effectiveFrom: '2025-01-01', monthlyWage: 1 }],
      months: [monthWithBase('2026-01', 10.04)],
    }));

    expect(result.months[0].mainIncentive.incentive).toBe(1.26);
  });
});
