import { describe, expect, it } from 'vitest';
import { defaultPreset, presetFormErrors } from './preset-defaults';

describe('preset editor validation', () => {
  it('accepts the initial standard Flat preset', () => {
    expect(presetFormErrors(defaultPreset())).toEqual([]);
  });

  it('rejects duplicate or descending Slab thresholds', () => {
    const preset = defaultPreset();
    preset.mainIncentive = {
      structure: 'slab',
      flat: null,
      slab: {
        thresholdType: 'fixed_amount',
        carryForwardEnabled: true,
        slabApplication: 'whole_eligible_base',
        slabs: [
          { minimumBase: 150000, rate: 0.1 },
          { minimumBase: 150000, rate: 0.125 },
        ],
      },
    };

    expect(presetFormErrors(preset)).toContain('Slab thresholds must be unique');
    expect(presetFormErrors(preset)).toContain('Slab thresholds must be strictly ascending');
  });
});
