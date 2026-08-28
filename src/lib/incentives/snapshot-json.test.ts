import { describe, expect, it } from 'vitest';
import { canonicalJson, parseSnapshotJson } from './snapshot-json';

describe('incentive snapshot JSON', () => {
  it('omits undefined object properties and preserves undefined array entries as null', () => {
    const serialized = canonicalJson({
      z: 2,
      initialState: undefined,
      a: 1,
      values: [undefined, 3],
    });

    expect(serialized).toBe('{"a":1,"values":[null,3],"z":2}');
    expect(JSON.parse(serialized)).toEqual({ a: 1, values: [null, 3], z: 2 });
  });

  it('reads snapshots created with the legacy undefined initialState token', () => {
    expect(parseSnapshotJson('{"employeeId":8,"initialState":undefined,"months":[]}', 'Input'))
      .toEqual({ employeeId: 8, months: [] });
  });

  it('rejects unrelated malformed snapshot data', () => {
    expect(() => parseSnapshotJson('{bad json}', 'Calculation input'))
      .toThrow('Calculation input contains invalid JSON');
  });
});
