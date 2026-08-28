export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => entry === undefined ? 'null' : canonicalJson(entry)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function parseSnapshotJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    // Compatibility for calculations persisted before undefined object values
    // were omitted by canonicalJson. The only affected optional engine field was
    // initialState, and omitting it preserves its original meaning.
    const repaired = value.replace(/,"initialState":undefined(?=,|})/g, '');
    if (repaired !== value) {
      try {
        return JSON.parse(repaired) as T;
      } catch {
        // Fall through to the stable, non-sensitive error below.
      }
    }
    throw new Error(`${label} contains invalid JSON`);
  }
}
