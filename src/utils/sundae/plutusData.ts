// Plutus data shape returned by cquisitor-lib's `decode_specific_type` when
// called with `{ plutus_data_schema: "DetailedSchema" }`.
//
// The library's exported PlutusData type is inaccurate at the time of writing
// — runtime values use the keys below, not the documented `constr` / `integer`
// / `bytestring`. Define our own types here so callers don't need to know.

export type PD =
  | { constructor: number; fields: PD[] }
  | { list: PD[] }
  | { map: { k: PD; v: PD }[] }
  | { int: number | bigint | string }
  | { bytes: string };

export function isConstr(d: PD): d is { constructor: number; fields: PD[] } {
  return typeof d === "object" && d !== null && "constructor" in d && "fields" in d;
}
export function isList(d: PD): d is { list: PD[] } {
  return typeof d === "object" && d !== null && "list" in d;
}
export function isMap(d: PD): d is { map: { k: PD; v: PD }[] } {
  return typeof d === "object" && d !== null && "map" in d;
}
export function isInt(d: PD): d is { int: number | bigint | string } {
  return typeof d === "object" && d !== null && "int" in d;
}
export function isBytes(d: PD): d is { bytes: string } {
  return typeof d === "object" && d !== null && "bytes" in d;
}

export function asConstr(d: PD): { tag: number; fields: PD[] } {
  if (!isConstr(d)) throw new Error(`expected Constr, got ${describe(d)}`);
  return { tag: d.constructor, fields: d.fields };
}
export function asList(d: PD): PD[] {
  if (!isList(d)) throw new Error(`expected List, got ${describe(d)}`);
  return d.list;
}
export function asInt(d: PD): bigint {
  if (!isInt(d)) throw new Error(`expected Int, got ${describe(d)}`);
  const v = d.int;
  if (typeof v === "bigint") return v;
  return BigInt(v);
}
export function asBytes(d: PD): string {
  if (!isBytes(d)) throw new Error(`expected Bytes, got ${describe(d)}`);
  return d.bytes;
}

// Optional<X> in plutus is encoded as Constr 0 [x] (Some) or Constr 1 [] (None).
export function asOptional<T>(d: PD, decode: (x: PD) => T): T | null {
  const c = asConstr(d);
  if (c.tag === 0) {
    if (c.fields.length !== 1) throw new Error("Some: expected 1 field");
    return decode(c.fields[0]);
  }
  if (c.tag === 1) return null;
  throw new Error(`Optional: unexpected ctor tag ${c.tag}`);
}

function describe(d: unknown): string {
  if (d == null) return String(d);
  if (typeof d !== "object") return typeof d;
  const keys = Object.keys(d);
  return `object with keys [${keys.join(", ")}]`;
}
