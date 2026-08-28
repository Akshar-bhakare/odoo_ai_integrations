import { describe, expect, it } from 'vitest';
import { makePreset } from './test-helpers';
import { assertPresetSchema, IncentivePresetSchemaError } from './preset-schema';

describe('preset JSON schema', () => {
  it('accepts the approved V1 preset shape', () => {
    expect(() => assertPresetSchema(makePreset())).not.toThrow();
  });

  it('rejects additional properties', () => {
    expect(() => assertPresetSchema({ ...makePreset(), hiddenOverride: true }))
      .toThrow(IncentivePresetSchemaError);
  });

  it('enforces preset code and currency patterns', () => {
    expect(() => assertPresetSchema({ ...makePreset(), code: 'invalid code' }))
      .toThrow(IncentivePresetSchemaError);
    expect(() => assertPresetSchema({ ...makePreset(), currency: 'INR1' }))
      .toThrow(IncentivePresetSchemaError);
  });
});
