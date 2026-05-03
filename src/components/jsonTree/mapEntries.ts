export interface MapEntry {
  key: string | number;
  value: unknown;
}

/**
 * `decode_cbor_against_cddl` emits two map shapes:
 *   - default: plain JSON object `{a: 1, b: 2}`
 *   - wire-order: `{ "@entries": [{ key, value, match }, ...] }` when
 *     keys are duplicates or complex (Array / Map / Tag).
 *
 * This collapses both into a uniform `[{key, value}]` list. For the
 * `@entries` form the key is whatever the lib decoded it to (string,
 * number, complex value); for the plain form it's just `Object.entries`.
 */
export function entriesAwareMapEntries(value: unknown): MapEntry[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const obj = value as Record<string, unknown>;
  const wire = obj["@entries"];
  if (Array.isArray(wire)) {
    return wire.map((e) => {
      const entry = e as { key: unknown; value: unknown };
      const k = entry.key;
      const keyOut: string | number = typeof k === "number" ? k : String(k);
      return { key: keyOut, value: entry.value };
    });
  }
  return Object.entries(obj).map(([k, v]) => ({ key: k, value: v }));
}

/** Plain `Object.entries` adapter — no special handling. */
export function plainMapEntries(value: unknown): MapEntry[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([k, v]) => ({
    key: k,
    value: v,
  }));
}
