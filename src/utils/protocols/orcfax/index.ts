// Orcfax decoder: normalized views + adapter registration.
//
// Role "feed": FS UTxOs are consumed as REFERENCE INPUTS by dApps, so there is
// no consumer-side redeemer to classify (datum-only). Both datum generations
// (V1 CER fact statement, V0 schema.org PropertyValue) are decoded.

import {
  registerDexAdapter,
  type DexIssue,
  type DexOrderView,
  type DexRole,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import { asBytes, isBytes, type PD } from "@/utils/protocols/dex/plutusData";
import { ORCFAX, matchOrcfaxNftPolicy, matchOrcfaxScriptHash } from "./constants";
import {
  parseOrcfaxFeed,
  type OrcfaxFeed,
  type OrcfaxV0Feed,
  type OrcfaxV1Feed,
} from "./feed";

// Render a Rational price as a decimal string when it divides cleanly enough,
// always keeping the exact "num / denom" alongside.
function formatPrice(num: bigint, denom: bigint): string {
  const fraction = `${num.toLocaleString()} / ${denom.toLocaleString()}`;
  if (denom === BigInt(0)) return fraction;
  // Compute a decimal with up to 10 fractional digits without floats.
  const scale = BigInt(10) ** BigInt(10);
  const scaled = (num * scale) / denom;
  const whole = scaled / scale;
  const frac = (scaled % scale).toString().padStart(10, "0").replace(/0+$/, "");
  const dec = frac.length > 0 ? `${whole}.${frac}` : `${whole}`;
  return `${dec} (${fraction})`;
}

// V0 value = significand * 10^exponent, rendered as a decimal string.
function formatV0Value(significand: bigint, exponent: bigint): string {
  const sig = significand.toString();
  if (exponent >= BigInt(0)) {
    return `${sig}${"0".repeat(Number(exponent))}`;
  }
  const e = -Number(exponent);
  const neg = sig.startsWith("-");
  const digits = neg ? sig.slice(1) : sig;
  const padded = digits.padStart(e + 1, "0");
  const cut = padded.length - e;
  const dec = `${padded.slice(0, cut)}.${padded.slice(cut)}`.replace(/0+$/, "").replace(/\.$/, "");
  return `${neg ? "-" : ""}${dec} (${sig} × 10^${exponent})`;
}

function v1ToView(feed: OrcfaxV1Feed): DexOrderView {
  const issues: DexIssue[] = [];
  if (feed.base === null || feed.quote === null) {
    issues.push({ severity: "info", message: `Could not parse base/quote from feed id "${feed.feedId}"` });
  }
  if (feed.denominator === BigInt(0)) {
    issues.push({ severity: "error", message: "Price denominator is zero" });
  }
  const pair = feed.base && feed.quote ? `${feed.base}/${feed.quote}` : feed.feedId;
  const rows: DexRow[] = [
    { label: "Feed", value: feed.feedId, mono: true },
    { label: "Pair", value: pair },
    { label: "Price", value: formatPrice(feed.numerator, feed.denominator) },
    { label: "Created at", value: `${feed.createdAt.toLocaleString()} (POSIX ms)` },
    { label: "Collector", value: feed.collector, hash: true },
  ];
  if (feed.collectAfter !== null) {
    rows.push({ label: "Collect after", value: `${feed.collectAfter.toLocaleString()} (POSIX ms)` });
  }
  return {
    protocol: "Orcfax",
    role: "feed",
    kind: "Fact Statement (CER)",
    rows,
    issues,
  };
}

function v0ToView(feed: OrcfaxV0Feed): DexOrderView {
  const issues: DexIssue[] = [];
  if (feed.values.length === 0) {
    issues.push({ severity: "warning", message: "V0 datum carried no value pairs" });
  }
  const pair = feed.base && feed.quote ? `${feed.base}/${feed.quote}` : feed.name ?? "unknown";
  const rows: DexRow[] = [
    { label: "Feed name", value: feed.name ?? "unknown" },
    { label: "Pair", value: pair },
  ];
  if (feed.values[0]) {
    rows.push({ label: "Value (rate)", value: formatV0Value(feed.values[0].significand, feed.values[0].exponent) });
  }
  if (feed.values[1]) {
    rows.push({ label: "Value (inverse)", value: formatV0Value(feed.values[1].significand, feed.values[1].exponent) });
  }
  if (feed.validFrom !== null) {
    rows.push({ label: "Valid from", value: `${feed.validFrom.toLocaleString()} (POSIX ms)` });
  }
  if (feed.validThrough !== null) {
    rows.push({ label: "Valid through", value: `${feed.validThrough.toLocaleString()} (POSIX ms)` });
  }
  if (feed.urn) rows.push({ label: "URN", value: feed.urn, mono: true });
  if (feed.identifier) rows.push({ label: "Identifier", value: feed.identifier, mono: true });
  if (feed.contentSignature) {
    rows.push({ label: "Content signature", value: feed.contentSignature, hash: true });
  }
  if (feed.sourceHash) rows.push({ label: "Source hash", value: feed.sourceHash, hash: true });
  return {
    protocol: "Orcfax",
    role: "feed",
    kind: "Fact Statement (schema.org / V0)",
    rows,
    issues,
  };
}

export function orcfaxFeedToView(feed: OrcfaxFeed): DexOrderView {
  return feed.generation === "v1" ? v1ToView(feed) : v0ToView(feed);
}

// The FSP (FactStatementPointer) datum is a bare ByteArray = the current FS
// validator hash. Render it as a pointer (not a feed) so it never parseErrors,
// and flag whether it still matches the FS hash(es) we decode feeds from.
function fspPointerToView(datum: PD): DexOrderView {
  const issues: DexIssue[] = [];
  let fsHash = "";
  if (isBytes(datum)) {
    fsHash = asBytes(datum).toLowerCase();
  } else {
    issues.push({ severity: "warning", message: "FSP datum is not a bare ByteArray pointer as expected" });
  }
  const known = fsHash !== "" && ORCFAX.fsValidatorHashes.includes(fsHash);
  if (fsHash !== "" && !known) {
    issues.push({
      severity: "info",
      message: `FS validator rotated to ${fsHash} — add it to ORCFAX.fsValidatorHashes to decode its feeds.`,
    });
  }
  const rows: DexRow[] = [
    { label: "FS validator", value: fsHash || "unknown", hash: true },
    {
      label: "Note",
      value: known
        ? "Price-feed UTxOs live at this (known) FS validator; they are read as reference inputs."
        : "Points to the current Fact-Statement validator that holds the price-feed UTxOs.",
    },
  ];
  return { protocol: "Orcfax", role: "feed-pointer", kind: "Fact Statement Pointer", rows, issues };
}

registerDexAdapter({
  id: "orcfax",
  label: "Orcfax",
  matchScriptHash: matchOrcfaxScriptHash,
  matchNftPolicy: matchOrcfaxNftPolicy,
  // Datum-only: FS UTxOs are read as reference inputs (no consumer redeemer).
  // role "feed" → decode the Fact Statement; role "feed-pointer" → the FSP
  // bare-bytes pointer to the FS validator.
  decode: (datum: PD, role: DexRole) => {
    if (role === "feed-pointer") return fspPointerToView(datum);
    return orcfaxFeedToView(parseOrcfaxFeed(datum));
  },
});

export * from "./feed";
export { ORCFAX } from "./constants";
