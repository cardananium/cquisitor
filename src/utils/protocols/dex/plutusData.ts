// Generic PlutusData shape + protocol-agnostic combinators shared by every DEX
// / dApp decoder.
//
// This is the canonical home for the `PD` type returned by cquisitor-lib's
// `decode_specific_type` when called with `{ plutus_data_schema: "DetailedSchema" }`.
// (The library's exported PlutusData type is inaccurate at the time of writing —
// runtime values use the keys below, not the documented `constr`/`integer`/
// `bytestring`.) `src/utils/sundae/plutusData.ts` re-exports everything here so
// the original SundaeSwap decoder keeps working unchanged.

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

// Bool: Constr 0 = False, Constr 1 = True (the standard PlutusData encoding).
export function asBool(d: PD): boolean {
  const c = asConstr(d);
  if (c.tag === 0) return false;
  if (c.tag === 1) return true;
  throw new Error(`Bool: unexpected ctor ${c.tag}`);
}

function describe(d: unknown): string {
  if (d == null) return String(d);
  if (typeof d !== "object") return typeof d;
  const keys = Object.keys(d);
  return `object with keys [${keys.join(", ")}]`;
}

// --- Cardano Address / Credential combinators ------------------------------
//
// Standard Cardano address/credential layout, which recurs identically across
// protocols:
//   Credential        = VerificationKey(hash) | Script(hash)        (ctor 0 / 1)
//   Referenced<Cred>  = Inline(cred) | Pointer(slot, txIdx, certIdx) (ctor 0 / 1)
//   Address           = Constr 0 [ paymentCredential, Option<Referenced<Cred>> ]

export type Credential =
  | { kind: "VKey"; hash: string }
  | { kind: "Script"; hash: string };

export type StakeCredential =
  | { kind: "Inline"; credential: Credential }
  | { kind: "Pointer"; slotNumber: bigint; transactionIndex: bigint; certificateIndex: bigint };

export interface PlutusAddress {
  paymentCredential: Credential;
  stakeCredential: StakeCredential | null;
}

export function parseCredential(d: PD): Credential {
  const c = asConstr(d);
  if (c.tag === 0) return { kind: "VKey", hash: asBytes(c.fields[0]) };
  if (c.tag === 1) return { kind: "Script", hash: asBytes(c.fields[0]) };
  throw new Error(`Credential: unexpected ctor ${c.tag}`);
}

// `Referenced<Credential>` (a.k.a. a stake credential reference).
export function parseStakeCredential(d: PD): StakeCredential {
  const c = asConstr(d);
  if (c.tag === 0) return { kind: "Inline", credential: parseCredential(c.fields[0]) };
  if (c.tag === 1) {
    return {
      kind: "Pointer",
      slotNumber: asInt(c.fields[0]),
      transactionIndex: asInt(c.fields[1]),
      certificateIndex: asInt(c.fields[2]),
    };
  }
  throw new Error(`StakeCredential: unexpected ctor ${c.tag}`);
}

export function parsePlutusAddress(d: PD): PlutusAddress {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`Address: unexpected ctor ${c.tag}`);
  return {
    paymentCredential: parseCredential(c.fields[0]),
    stakeCredential: asOptional(c.fields[1], parseStakeCredential),
  };
}

// --- AssetClass / Rational / tuple combinators -----------------------------

export interface AssetClass {
  policyId: string;
  assetName: string;
}

// AssetClass encoded as a Constr 0 [policyId, assetName]. ada = ("", "").
export function parseAssetClass(d: PD): AssetClass {
  const c = asConstr(d);
  if (c.fields.length !== 2) throw new Error("AssetClass: expected (policy, name)");
  return { policyId: asBytes(c.fields[0]), assetName: asBytes(c.fields[1]) };
}

// AssetClass encoded as a plain 2-element List [policyId, assetName] (distinct
// from the Constr form above).
export function parseAssetPair(d: PD): AssetClass {
  const list = asList(d);
  if (list.length !== 2) throw new Error("AssetClass: expected (policy, name) pair");
  return { policyId: asBytes(list[0]), assetName: asBytes(list[1]) };
}

export interface AssetAmount extends AssetClass {
  amount: bigint;
}

// (policyId, assetName, amount) as a 3-element List — the SundaeSwap
// "SingletonValue" shape. ada is ("", "", n).
export function parseAssetTriple(d: PD): AssetAmount {
  const list = asList(d);
  if (list.length !== 3) throw new Error("expected (policy, name, amount) triple");
  return {
    policyId: asBytes(list[0]),
    assetName: asBytes(list[1]),
    amount: asInt(list[2]),
  };
}

export interface Rational {
  numerator: bigint;
  denominator: bigint;
}

// Rational encoded as Constr 0 [numerator, denominator]. Some protocols instead
// use a bare 2-element List — use parseRatioList.
export function parseRational(d: PD): Rational {
  const c = asConstr(d);
  if (c.fields.length !== 2) throw new Error("Rational: expected (num, den)");
  return { numerator: asInt(c.fields[0]), denominator: asInt(c.fields[1]) };
}

export function parseRatioList(d: PD): Rational {
  const list = asList(d);
  if (list.length !== 2) throw new Error("Rational: expected (num, den) list");
  return { numerator: asInt(list[0]), denominator: asInt(list[1]) };
}
