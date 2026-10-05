// Decoders for the constraint payloads a V4 order carries.
//
// An order's `constraints` is a list of `(validator hash, payload)` pairs. The
// hash names the withdraw validator that enforces the constraint; the payload's
// shape is that validator's business and nothing in the datum describes it. So
// decoding runs in two steps: resolve the hash to a validator title against the
// deployment (v4Registry.ts), then dispatch on the title.
//
// Payload layouts follow the `extract_*` functions in sundae-v4, which read
// their fields positionally with raw builtins:
//   lib/constraints/basic.ak     BasicFields    { offered, min_received }
//   lib/constraints/swap.ak      SwapFields     { offered, original_offered,
//                                                 remaining_offered, min_received }
//   lib/constraints/strategy.ak  StrategyConstraints { auth, final_destinations }
//   validators/constraints/route.ak            a bare List<Ident> pool whitelist
//
// An unrecognized hash is not an error: V4 is extensible by design, and a
// deployment may run a constraint this build has never seen. Those surface as
// `kind: "unknown"` with the payload intact.

import type { CardanoNetwork } from "@cardananium/cquisitor-lib";
import { asBytes, asConstr, asInt, asList, asOptional, type PD } from "./plutusData";
import { parseMultisig, type MultisigScript } from "./v3";
import {
  parseAssetEntryList,
  parseV4Destination,
  type V4AssetEntry,
  type V4ConstraintEntry,
  type V4Destination,
} from "./v4";
import { lookupV4Script, moduleLabelFromTitle } from "./v4Registry";
import { parseAssetClass, type AssetClass } from "./plutusData";

/**
 * The subtype a basic order declares through its payload's constructor index.
 *
 * The validator reads the payload with `unconstr_fields` and never looks at the
 * index, so this is advisory — dispatch metadata the builder writes for the
 * scooper, not a checked claim. All four share one field shape. Indices are the
 * SDK's `EV4BasicConstraint`.
 */
export type V4BasicSubtype = "Deposit" | "Withdraw" | "Swap" | "Claim";

const BASIC_SUBTYPES: Record<number, V4BasicSubtype> = {
  0: "Deposit",
  1: "Withdraw",
  2: "Swap",
  3: "Claim",
};

/** A single-shot order: give `offered`, receive at least `minReceived`. */
export interface V4BasicConstraint {
  kind: "basic";
  /** The declared subtype, or null when the index is outside the known four. */
  subtype: V4BasicSubtype | null;
  /** The raw constructor index, kept so an unknown one is still reportable. */
  subtypeTag: number;
  offered: V4AssetEntry[];
  minReceived: V4AssetEntry[];
}

/** A partially fillable swap. `remainingOffered` falls as the order is filled. */
export interface V4SwapConstraint {
  kind: "swap";
  offered: AssetClass;
  originalOffered: bigint;
  remainingOffered: bigint;
  minReceived: V4AssetEntry[];
}

/** An order whose fills are authorized off-chain by `auth`. */
export interface V4StrategyConstraint {
  kind: "strategy";
  auth: MultisigScript;
  finalDestinations: V4Destination[];
}

/** A multi-hop order. The payload is the pools it may route through. */
export interface V4RouteConstraint {
  kind: "route";
  /** Pool identifiers the route may use. Empty = unrestricted. */
  poolWhitelist: string[];
}

/** The fee aggregator. Carries no payload of its own in the shapes we've seen. */
export interface V4FeeConstraint {
  kind: "fee";
}

/** Anti-sandwich ordering. Payload is module-internal. */
export interface V4FairnessConstraint {
  kind: "fairness";
}

export interface V4UnknownConstraint {
  kind: "unknown";
  /** The validator title when the hash is in a known deployment, else null. */
  title: string | null;
  /** Why we could not decode: an unknown validator, or a decode failure. */
  reason: string;
}

export type V4ConstraintBody =
  | V4BasicConstraint
  | V4SwapConstraint
  | V4StrategyConstraint
  | V4RouteConstraint
  | V4FeeConstraint
  | V4FairnessConstraint
  | V4UnknownConstraint;

/** A constraint resolved against a deployment: what enforces it, and its payload. */
export interface V4DecodedConstraint {
  /** The 28-byte validator hash from the order datum. */
  hash: string;
  /** Validator title, e.g. "swap_order.withdraw". Null when not in a deployment. */
  title: string | null;
  /** Readable module name, e.g. "swap order". Falls back to a short hash. */
  label: string;
  body: V4ConstraintBody;
  /** The raw payload, always kept so the completeness view can show it. */
  raw: PD;
}

// --- Payload decoders -----------------------------------------------------

function decodeBasic(data: PD): V4BasicConstraint {
  const c = asConstr(data);
  if (c.fields.length < 2) {
    throw new Error(`basic: expected 2 fields, got ${c.fields.length}`);
  }
  return {
    kind: "basic",
    subtype: BASIC_SUBTYPES[c.tag] ?? null,
    subtypeTag: c.tag,
    offered: parseAssetEntryList(c.fields[0]),
    minReceived: parseAssetEntryList(c.fields[1]),
  };
}

function decodeSwap(data: PD): V4SwapConstraint {
  const c = asConstr(data);
  if (c.fields.length < 4) {
    throw new Error(`swap: expected 4 fields, got ${c.fields.length}`);
  }
  return {
    kind: "swap",
    offered: parseAssetClass(c.fields[0]),
    originalOffered: asInt(c.fields[1]),
    remainingOffered: asInt(c.fields[2]),
    minReceived: parseAssetEntryList(c.fields[3]),
  };
}

function decodeStrategy(data: PD): V4StrategyConstraint {
  const c = asConstr(data);
  if (c.fields.length < 2) {
    throw new Error(`strategy: expected 2 fields, got ${c.fields.length}`);
  }
  return {
    kind: "strategy",
    auth: parseMultisig(c.fields[0]),
    finalDestinations: asList(c.fields[1]).map(parseV4Destination),
  };
}

function decodeRoute(data: PD): V4RouteConstraint {
  // The payload is a bare `List<Ident>` — the pool whitelist — not a Constr.
  return { kind: "route", poolWhitelist: asList(data).map((d) => asBytes(d)) };
}

// Validator title (endpoint suffix stripped) → decoder. A deployment may expose
// several generations of one validator (`stableswap.withdraw.superseded1`), so
// we key on the base name.
const DECODERS: Record<string, (data: PD) => V4ConstraintBody> = {
  basic_order: decodeBasic,
  swap_order: decodeSwap,
  strategy_order: decodeStrategy,
  route: decodeRoute,
  fee_constraint: () => ({ kind: "fee" }),
  fairness_order: () => ({ kind: "fairness" }),
  fairness: () => ({ kind: "fairness" }),
};

function baseName(title: string): string {
  return title.replace(/\.(spend|withdraw|mint|publish)(\.superseded\d+)?$/, "");
}

function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

/**
 * Resolve and decode one constraint entry against the deployment for `network`.
 * Never throws — a payload that does not match its validator's expected shape
 * comes back as `unknown` with the reason, so one odd constraint cannot stop an
 * order from rendering.
 */
export function decodeV4Constraint(
  entry: V4ConstraintEntry,
  network: CardanoNetwork | undefined,
): V4DecodedConstraint {
  const match = lookupV4Script(entry.hash, network);
  const title = match?.title ?? null;
  const label = title ? moduleLabelFromTitle(title) : shortHash(entry.hash);

  if (!title) {
    return {
      hash: entry.hash,
      title: null,
      label,
      raw: entry.data,
      body: {
        kind: "unknown",
        title: null,
        reason: "constraint validator is not part of a known V4 deployment",
      },
    };
  }

  const decoder = DECODERS[baseName(title)];
  if (!decoder) {
    return {
      hash: entry.hash,
      title,
      label,
      raw: entry.data,
      body: {
        kind: "unknown",
        title,
        reason: `no decoder for ${title}`,
      },
    };
  }

  try {
    return { hash: entry.hash, title, label, raw: entry.data, body: decoder(entry.data) };
  } catch (e) {
    return {
      hash: entry.hash,
      title,
      label,
      raw: entry.data,
      body: {
        kind: "unknown",
        title,
        reason: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

export function decodeV4Constraints(
  entries: V4ConstraintEntry[],
  network: CardanoNetwork | undefined,
): V4DecodedConstraint[] {
  return entries.map((e) => decodeV4Constraint(e, network));
}

/**
 * The constraint that describes what the order DOES, as opposed to the ones
 * that price or sequence it. An order carries several constraints — a swap plus
 * a fee constraint, say — and only one of them is the action.
 */
export function primaryConstraint(
  constraints: V4DecodedConstraint[],
): V4DecodedConstraint | null {
  const rank: Record<string, number> = {
    swap: 0,
    basic: 1,
    strategy: 2,
    route: 3,
    unknown: 4,
    fairness: 5,
    fee: 6,
  };
  let best: V4DecodedConstraint | null = null;
  for (const c of constraints) {
    if (!best || rank[c.body.kind] < rank[best.body.kind]) best = c;
  }
  return best;
}

/**
 * A short human label for an order, e.g. "Swap", "Deposit / Withdraw",
 * "Strategy". Basic orders cover deposit, withdraw, claim and donation, and
 * nothing in the constraint distinguishes them — the asset shape does, so the
 * caller passes what it inferred.
 */
export function describeV4OrderKind(constraints: V4DecodedConstraint[]): string {
  const primary = primaryConstraint(constraints);
  if (!primary) return "Order";
  switch (primary.body.kind) {
    case "swap":
      return "Swap";
    case "basic":
      return describeBasicKind(primary.body);
    case "strategy":
      return "Strategy";
    case "route":
      return "Route";
    case "fairness":
      return "Fairness";
    case "fee":
      return "Fee";
    case "unknown":
      return primary.title ? moduleLabelFromTitle(primary.title) : "Unknown order";
  }
}

/**
 * Name a basic order. The payload's constructor index declares the subtype and
 * is the answer whenever it is one of the known four. It is advisory — the
 * validator never reads it — so an index outside that range falls back to the
 * asset shape: offering two or more assets for one reads as a deposit, one for
 * two as a withdrawal.
 */
function describeBasicKind(body: V4BasicConstraint): string {
  if (body.subtype) return body.subtype;
  const offered = body.offered.length;
  const received = body.minReceived.length;
  if (offered === 0 && received > 0) return "Claim";
  if (offered >= 2 && received === 1) return "Deposit";
  if (offered === 1 && received >= 2) return "Withdraw";
  return "Order";
}

/** The route steps a decoded constraint list declares, if it carries a route. */
export function routeWhitelist(constraints: V4DecodedConstraint[]): string[] | null {
  for (const c of constraints) {
    if (c.body.kind === "route") return c.body.poolWhitelist;
  }
  return null;
}

/**
 * A strategy order's signed execution, as attached to the strategy validator's
 * redeemer. `minDeltas` is the complete value-change spec: positive entries are
 * minimums the order must receive, negative entries are signed permission to
 * consume, and an unlisted asset may not leave.
 */
export interface V4StrategyExecution {
  minDeltas: V4AssetEntry[];
  /** Index into the constraint's `finalDestinations`, or null for the datum's own. */
  final: number | null;
}

export function parseV4StrategyExecution(data: PD): V4StrategyExecution | null {
  try {
    const c = asConstr(data);
    if (c.fields.length < 2) return null;
    return {
      minDeltas: parseAssetEntryList(c.fields[0]),
      final: asOptional(c.fields[1], (x) => Number(asInt(x))),
    };
  } catch {
    return null;
  }
}
