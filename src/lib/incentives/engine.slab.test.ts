import { describe, expect, it } from 'vitest';
import { calculateIncentives } from './engine';
import { makeInput, makePreset, monthWithBase } from './test-helpers';

function fixedSlabPreset() {
  const preset = makePreset();
  preset.mainIncentive = {
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
  return preset;
}

describe('Slab incentive calculations', () => {
  it('selects the slab from current recognized base after lakh-based carry consumption', () => {
    const preset = makePreset();
    preset.mainIncentive = {
      structure: 'slab',
      flat: null,
      slab: {
        thresholdType: 'fixed_amount',
        carryForwardEnabled: true,
        slabApplication: 'whole_eligible_base',
        slabs: [
          { minimumBase: 300000, rate: 0.1 },
          { minimumBase: 350000, rate: 0.125 },
        ],
      },
    };
    const result = calculateIncentives(makeInput({
      preset,
      months: [monthWithBase('2026-01', 200000), monthWithBase('2026-02', 400000)],
    }));

    expect(result.months[0].mainIncentive.carryOut).toBe(100000);
    expect(result.months[1].mainIncentive.currentRecognizedBase).toBe(300000);
    expect(result.months[1].mainIncentive.achievedRate).toBe(0.1);
    expect(result.months[1].mainIncentive.incentive).toBe(30000);
  });

  it('uses the highest matching threshold and applies its rate to the whole base', () => {
    const result = calculateIncentives(makeInput({
      preset: fixedSlabPreset(),
      months: [monthWithBase('2026-01', 170000)],
    }));

    expect(result.months[0].mainIncentive.achievedRate).toBe(0.125);
    expect(result.months[0].mainIncentive.slabSelectionBase).toBe(170000);
    expect(result.months[0].mainIncentive.incentive).toBe(21250);
  });

  it('consumes carry before slab selection without paying previous base', () => {
    const result = calculateIncentives(makeInput({
      preset: fixedSlabPreset(),
      months: [monthWithBase('2026-01', 80000), monthWithBase('2026-02', 160000)],
    }));

    expect(result.months[0].mainIncentive.carryOut).toBe(40000);
    expect(result.months[1].mainIncentive.carryConsumed).toBe(40000);
    expect(result.months[1].mainIncentive.currentRecognizedBase).toBe(120000);
    expect(result.months[1].mainIncentive.achievedRate).toBe(0.1);
    expect(result.months[1].mainIncentive.incentive).toBe(12000);
    expect(result.months[1].mainIncentive.accumulatedUnpaidBaseIn).toBe(0);
  });

  it('resolves salary-multiple slab thresholds from first-day salary', () => {
    const preset = makePreset();
    preset.mainIncentive = {
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

    const result = calculateIncentives(makeInput({
      preset,
      months: [monthWithBase('2026-01', 75000)],
    }));

    expect(result.months[0].mainIncentive.firstSlabThreshold).toBe(60000);
    expect(result.months[0].mainIncentive.achievedRate).toBe(0.125);
    expect(result.months[0].mainIncentive.incentive).toBe(9375);
  });

  it('increases slab carry when Actual Base is negative', () => {
    const result = calculateIncentives(makeInput({
      preset: fixedSlabPreset(),
      months: [monthWithBase('2026-01', -70000)],
    }));

    expect(result.months[0].mainIncentive.carryOut).toBe(190000);
  });

  it('does not retain slab shortfall when carry is disabled', () => {
    const preset = fixedSlabPreset();
    if (preset.mainIncentive.structure !== 'slab') throw new Error('Expected Slab preset');
    preset.mainIncentive.slab.carryForwardEnabled = false;

    const result = calculateIncentives(makeInput({
      preset,
      months: [monthWithBase('2026-01', 80000), monthWithBase('2026-02', 150000)],
    }));

    expect(result.months[0].mainIncentive.carryOut).toBe(0);
    expect(result.months[1].mainIncentive.achievedRate).toBe(0.125);
    expect(result.months[1].mainIncentive.incentive).toBe(18750);
  });
});
