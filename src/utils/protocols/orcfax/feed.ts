// Orcfax Fact Statement (FS) datum parsers.
//
// Two on-chain datum generations exist in the wild; both are supported. The
// outer value is always Constr0 (CBOR tag 0xd879). We disambiguate by the type
// of field[0]:
//   - field[0] is a Map (schema.org value map)            => V0 PropertyValue
//   - field[0] is a Constr0 (statement) w/ "CER/…" feed_id => V1 Fact Statement
//
// Constr alt encodes as CBOR tag 121+alt (alt 0 => 121 => 0xd879, alt 1 => 122
// => 0xd87a, alt 3 => 124 => 0xd87c). cquisitor-lib's DetailedSchema decodes
// these to a 0-based `constructor` index (alt N => constructor N).

import {
  asBytes,
  asConstr,
  asInt,
  asList,
  isBytes,
  isConstr,
  isInt,
  isMap,
  type PD,
} from "@/utils/protocols/dex/plutusData";

// --- shared helpers --------------------------------------------------------

// Decode a bare ByteArray that carries ASCII text (feed_id, identifier, etc.).
function bytesToAscii(hex: string): string {
  if (hex.length % 2 !== 0) return hex;
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(code)) return hex;
    out += String.fromCharCode(code);
  }
  return out;
}

// V0 exponents are signed ints encoded as uint64 two's-complement. Sign-correct:
// if v >= 2^63 then v -= 2^64.
const TWO_POW_63 = BigInt("9223372036854775808"); // 2^63
const TWO_POW_64 = BigInt("18446744073709551616"); // 2^64
function signCorrect(v: bigint): bigint {
  return v >= TWO_POW_63 ? v - TWO_POW_64 : v;
}

// =================================================================
// V1 — "CER" / Fact Statement (current mainnet, schema /3)
// =================================================================
//
// Datum   = Constr0 [ statement, context ]
// statement = Constr0 [ feed_id:ByteArray, created_at:Int(ms), body:Rational ]
// body      = Constr0 [ numerator:Int, denominator:Int ]
// context   = Constr0 [ collector:ByteArray(28) ]   (1 field observed on-chain)
//          OR Constr0 [ collect_after:Int, collector:ByteArray(28) ]  (2 fields)

export interface OrcfaxV1Feed {
  generation: "v1";
  /** Raw feed id bytes (hex). */
  feedIdHex: string;
  /** Decoded ASCII feed id, e.g. "CER/ADA-USD/3". */
  feedId: string;
  /** Base symbol parsed from "CER/<BASE>-<QUOTE>/3", or null. */
  base: string | null;
  /** Quote symbol, or null. */
  quote: string | null;
  /** Unix timestamp in milliseconds. */
  createdAt: bigint;
  numerator: bigint;
  denominator: bigint;
  /** Optional collect-after timestamp (present only in the 2-field context). */
  collectAfter: bigint | null;
  /** 28-byte collector credential hash (hex). */
  collector: string;
}

function parseFeedPair(feedId: string): { base: string | null; quote: string | null } {
  // Form: "CER/<BASE>-<QUOTE>/3"
  const parts = feedId.split("/");
  if (parts.length >= 2) {
    const dash = parts[1].split("-");
    if (dash.length === 2) return { base: dash[0], quote: dash[1] };
  }
  return { base: null, quote: null };
}

function parseV1(outer: PD): OrcfaxV1Feed {
  const c = asConstr(outer);
  if (c.tag !== 0) throw new Error(`Orcfax V1 Datum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 2) {
    throw new Error(`Orcfax V1 Datum: expected [statement, context], got ${c.fields.length} fields`);
  }

  const statement = asConstr(c.fields[0]);
  if (statement.tag !== 0) throw new Error(`Orcfax V1 statement: unexpected ctor ${statement.tag}`);
  if (statement.fields.length !== 3) {
    throw new Error(`Orcfax V1 statement: expected [feed_id, created_at, body], got ${statement.fields.length}`);
  }
  const feedIdHex = asBytes(statement.fields[0]);
  const feedId = bytesToAscii(feedIdHex);
  const createdAt = asInt(statement.fields[1]);

  const body = asConstr(statement.fields[2]);
  if (body.tag !== 0) throw new Error(`Orcfax V1 body: unexpected ctor ${body.tag}`);
  if (body.fields.length !== 2) {
    throw new Error(`Orcfax V1 body (Rational): expected [num, denom], got ${body.fields.length}`);
  }
  const numerator = asInt(body.fields[0]);
  const denominator = asInt(body.fields[1]);

  // Context: tolerate 1 OR 2 fields (see spec openQuestion #2).
  const context = asConstr(c.fields[1]);
  let collectAfter: bigint | null = null;
  let collector: string;
  if (context.fields.length === 1) {
    collector = asBytes(context.fields[0]);
  } else if (context.fields.length === 2) {
    collectAfter = asInt(context.fields[0]);
    collector = asBytes(context.fields[1]);
  } else {
    throw new Error(`Orcfax V1 context: expected 1 or 2 fields, got ${context.fields.length}`);
  }

  const { base, quote } = parseFeedPair(feedId);
  return {
    generation: "v1",
    feedIdHex,
    feedId,
    base,
    quote,
    createdAt,
    numerator,
    denominator,
    collectAfter,
    collector,
  };
}

// =================================================================
// V0 — schema.org "PropertyValue" (legacy, still on mainnet)
// =================================================================
//
// Datum (PriceFeed) = Constr0 [ value_map:Map, identifier:ByteArray,
//                               valid_through:Constr1[ts:Int, hash:BA], signature ]
// value_map keys (ByteArray ASCII) include "@context", "type", "name",
//   "value" (List of 2 ValuePair=Constr3[significand,base10_exponent]),
//   "valueReference", "identifier", "_:contentSignature".
//
// Map order is NOT guaranteed on-chain → decode value_map by KEY, not position.

export interface OrcfaxV0ValuePair {
  significand: bigint;
  /** Sign-corrected base-10 exponent. value = significand * 10^exponent. */
  exponent: bigint;
}

export interface OrcfaxV0Feed {
  generation: "v0";
  /** Feed label, e.g. "ADA-USD|USD-ADA", decoded ASCII (or null if absent). */
  name: string | null;
  /** Base symbol from "<BASE>-<QUOTE>|…", or null. */
  base: string | null;
  /** Quote symbol, or null. */
  quote: string | null;
  /** The two ValuePairs from value_map["value"] (rate + inverse). */
  values: OrcfaxV0ValuePair[];
  /** validFrom in ms (from valueReference), or null. */
  validFrom: bigint | null;
  /** validThrough in ms — from the Expiry Constr1 timestamp, or null. */
  validThrough: bigint | null;
  /** Top-level Arkly/CID identifier (field[1]), decoded ASCII. */
  identifier: string | null;
  /** urn:orcfax:<uuid> from value_map["identifier"]["value"], or null. */
  urn: string | null;
  /** 32-byte content signature hex from "_:contentSignature", or null. */
  contentSignature: string | null;
  /** Trailing 28-byte source/collector hash from the Expiry Constr1, or null. */
  sourceHash: string | null;
}

// Look up a key (ASCII) in a value_map (Map keyed by ByteArray).
function mapGet(entries: { k: PD; v: PD }[], keyAscii: string): PD | null {
  for (const { k, v } of entries) {
    if (isBytes(k) && bytesToAscii(asBytes(k)) === keyAscii) return v;
  }
  return null;
}

function safeAscii(d: PD | null): string | null {
  if (d && isBytes(d)) return bytesToAscii(asBytes(d));
  return null;
}

function parseV0Name(name: string | null): { base: string | null; quote: string | null } {
  if (!name) return { base: null, quote: null };
  // "ADA-USD|USD-ADA" → take the first pair before "|".
  const first = name.split("|")[0];
  const dash = first.split("-");
  if (dash.length === 2) return { base: dash[0], quote: dash[1] };
  return { base: null, quote: null };
}

function parseV0ValuePair(d: PD): OrcfaxV0ValuePair {
  const c = asConstr(d);
  // ValuePair = Constr3 [ significand:Int, base10_exponent:Int ].
  if (c.fields.length !== 2) {
    throw new Error(`Orcfax V0 ValuePair: expected [significand, exponent], got ${c.fields.length}`);
  }
  return {
    significand: asInt(c.fields[0]),
    exponent: signCorrect(asInt(c.fields[1])),
  };
}

// Pull a ms Int from a valueReference entry whose "name" matches `which`.
function readValueRefTimestamp(valueRef: PD | null, which: string): bigint | null {
  if (!valueRef || !isList(valueRef)) return null;
  for (const item of asList(valueRef)) {
    if (!isMap(item)) continue;
    const entries = item.map;
    const name = safeAscii(mapGet(entries, "name"));
    if (name === which) {
      const v = mapGet(entries, "value");
      if (v && isInt(v)) return asInt(v);
    }
  }
  return null;
}

// local isList (plutusData only exports isBytes/isConstr/isInt/isMap here).
function isList(d: PD): d is { list: PD[] } {
  return typeof d === "object" && d !== null && "list" in d;
}

function parseV0(outer: PD): OrcfaxV0Feed {
  const c = asConstr(outer);
  if (c.tag !== 0) throw new Error(`Orcfax V0 Datum: unexpected ctor ${c.tag}`);
  if (c.fields.length < 3) {
    throw new Error(`Orcfax V0 PriceFeed: expected ≥3 fields, got ${c.fields.length}`);
  }
  if (!isMap(c.fields[0])) throw new Error("Orcfax V0 PriceFeed: field[0] is not a value Map");
  const entries = c.fields[0].map;

  const name = safeAscii(mapGet(entries, "name"));
  const { base, quote } = parseV0Name(name);

  const valueNode = mapGet(entries, "value");
  const values: OrcfaxV0ValuePair[] = valueNode && isList(valueNode)
    ? asList(valueNode).map(parseV0ValuePair)
    : [];

  const valueRef = mapGet(entries, "valueReference");
  const validFrom = readValueRefTimestamp(valueRef, "validFrom");

  // contentSignature is a 32-byte sha-256 hash — keep it as raw hex, not ASCII.
  const csNode = mapGet(entries, "_:contentSignature");
  const contentSignature = csNode && isBytes(csNode) ? asBytes(csNode) : null;

  // urn from value_map["identifier"]["value"].
  let urn: string | null = null;
  const idMap = mapGet(entries, "identifier");
  if (idMap && isMap(idMap)) {
    urn = safeAscii(mapGet(idMap.map, "value"));
  }

  // field[1] = top-level Arkly identifier (ByteArray ASCII).
  const identifier = c.fields.length > 1 ? safeAscii(c.fields[1]) : null;

  // field[2] = valid_through Expiry = Constr1 [ timestamp:Int, source_hash:BA ].
  // The exact field[2]/field[3] split is an openQuestion: read robustly.
  let validThrough: bigint | null = null;
  let sourceHash: string | null = null;
  if (c.fields.length > 2 && isConstr(c.fields[2])) {
    const expiry = asConstr(c.fields[2]);
    for (const f of expiry.fields) {
      if (isInt(f) && validThrough === null) validThrough = asInt(f);
      else if (isBytes(f) && sourceHash === null) sourceHash = asBytes(f);
    }
  }
  // Some encodings carry the trailing hash as a separate field[3].
  if (sourceHash === null && c.fields.length > 3 && isBytes(c.fields[3])) {
    sourceHash = asBytes(c.fields[3]);
  }

  return {
    generation: "v0",
    name,
    base,
    quote,
    values,
    validFrom,
    validThrough,
    identifier,
    urn,
    contentSignature,
    sourceHash,
  };
}

// =================================================================
// Dispatcher
// =================================================================

export type OrcfaxFeed = OrcfaxV1Feed | OrcfaxV0Feed;

export function parseOrcfaxFeed(data: PD): OrcfaxFeed {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Orcfax Datum: unexpected outer ctor ${c.tag}`);
  const first = c.fields[0];
  if (first && isMap(first)) return parseV0(data);
  if (first && isConstr(first)) {
    // V1 statement: field[0] is the statement Constr; its first field is the
    // feed_id ByteArray (typically starting "CER/").
    return parseV1(data);
  }
  throw new Error("Orcfax Datum: unrecognized shape (field[0] is neither Map nor Constr)");
}
