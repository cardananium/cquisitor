import {
  asBytes,
  asConstr,
  asInt,
  asList,
  asOptional,
  isConstr,
  type PD,
} from "./plutusData";

// Mirrors sundae-sdk Contract.v3.ts. Only fields we surface in the UI are
// strictly typed; the raw plutus data is kept on the side for advanced display.

export interface V3OrderDatum {
  poolIdent: string | null;
  owner: MultisigScript;
  maxProtocolFee: bigint;
  destination: Destination;
  details: Order;
  // The extension field is opaque (Data) — keep raw plutus for display only.
  extension: PD;
}

export type MultisigScript =
  | { kind: "Signature"; keyHash: string }
  | { kind: "AllOf"; scripts: MultisigScript[] }
  | { kind: "AnyOf"; scripts: MultisigScript[] }
  | { kind: "AtLeast"; required: bigint; scripts: MultisigScript[] }
  | { kind: "Before"; time: bigint }
  | { kind: "After"; time: bigint }
  | { kind: "Script"; scriptHash: string };

export type Destination =
  | { kind: "Fixed"; address: PlutusAddress; datum: DatumOption }
  | { kind: "Self" };

export interface PlutusAddress {
  paymentCredential: Credential;
  stakeCredential: StakeCredential | null;
}

export type Credential =
  | { kind: "VKey"; hash: string }
  | { kind: "Script"; hash: string };

export type StakeCredential =
  | { kind: "Inline"; credential: Credential }
  | { kind: "Pointer"; slotNumber: bigint; transactionIndex: bigint; certificateIndex: bigint };

export type DatumOption =
  | { kind: "NoDatum" }
  | { kind: "DatumHash"; hash: string }
  | { kind: "InlineDatum"; data: PD };

// AssetClass-with-amount, encoded as (policyId, assetName, amount).
// Special cased: ada is ("", "", n).
export interface AssetAmount {
  policyId: string;
  assetName: string;
  amount: bigint;
}

export type Order =
  | { kind: "Strategy"; auth: StrategyAuthorization }
  | { kind: "Swap"; offer: AssetAmount; minReceived: AssetAmount }
  | { kind: "Deposit"; assets: [AssetAmount, AssetAmount] }
  | { kind: "Withdrawal"; lpAmount: AssetAmount }
  | { kind: "Donation"; assets: [AssetAmount, AssetAmount] }
  | { kind: "Record"; policy: { policyId: string; assetName: string } };

export type StrategyAuthorization =
  | { kind: "Signature"; signer: string }
  | { kind: "Script"; scriptHash: string };

// --- Parsers --------------------------------------------------------------

function parseMultisig(d: PD): MultisigScript {
  const c = asConstr(d);
  switch (c.tag) {
    case 0: // Signature { keyHash }
      return { kind: "Signature", keyHash: asBytes(c.fields[0]) };
    case 1: // AllOf { scripts }
      return { kind: "AllOf", scripts: asList(c.fields[0]).map(parseMultisig) };
    case 2: // AnyOf { scripts }
      return { kind: "AnyOf", scripts: asList(c.fields[0]).map(parseMultisig) };
    case 3: // AtLeast { required, scripts }
      return {
        kind: "AtLeast",
        required: asInt(c.fields[0]),
        scripts: asList(c.fields[1]).map(parseMultisig),
      };
    case 4: // Before { time }
      return { kind: "Before", time: asInt(c.fields[0]) };
    case 5: // After { time }
      return { kind: "After", time: asInt(c.fields[0]) };
    case 6: // Script { scriptHash }
      return { kind: "Script", scriptHash: asBytes(c.fields[0]) };
    default:
      throw new Error(`MultisigScript: unexpected ctor ${c.tag}`);
  }
}

function parseCredential(d: PD): Credential {
  const c = asConstr(d);
  if (c.tag === 0) return { kind: "VKey", hash: asBytes(c.fields[0]) };
  if (c.tag === 1) return { kind: "Script", hash: asBytes(c.fields[0]) };
  throw new Error(`Credential: unexpected ctor ${c.tag}`);
}

function parseStakeCredential(d: PD): StakeCredential {
  const c = asConstr(d);
  if (c.tag === 0) {
    return { kind: "Inline", credential: parseCredential(c.fields[0]) };
  }
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

function parseAddress(d: PD): PlutusAddress {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`Address: unexpected ctor ${c.tag}`);
  return {
    paymentCredential: parseCredential(c.fields[0]),
    stakeCredential: asOptional(c.fields[1], parseStakeCredential),
  };
}

function parseDatumOption(d: PD): DatumOption {
  const c = asConstr(d);
  if (c.tag === 0) return { kind: "NoDatum" };
  if (c.tag === 1) return { kind: "DatumHash", hash: asBytes(c.fields[0]) };
  if (c.tag === 2) return { kind: "InlineDatum", data: c.fields[0] };
  throw new Error(`DatumOption: unexpected ctor ${c.tag}`);
}

function parseDestination(d: PD): Destination {
  const c = asConstr(d);
  if (c.tag === 0) {
    // Fixed { address, datum }
    return {
      kind: "Fixed",
      address: parseAddress(c.fields[0]),
      datum: parseDatumOption(c.fields[1]),
    };
  }
  if (c.tag === 1) return { kind: "Self" };
  throw new Error(`Destination: unexpected ctor ${c.tag}`);
}

function parseAssetTriple(d: PD): AssetAmount {
  // List<ByteArray, ByteArray, Int>
  const list = asList(d);
  if (list.length !== 3) throw new Error(`expected (policy, name, amount) triple`);
  return {
    policyId: asBytes(list[0]),
    assetName: asBytes(list[1]),
    amount: asInt(list[2]),
  };
}

function parseAssetPair(d: PD): { policyId: string; assetName: string } {
  const list = asList(d);
  if (list.length !== 2) throw new Error(`expected (policy, name) pair`);
  return { policyId: asBytes(list[0]), assetName: asBytes(list[1]) };
}

function parseStrategyAuth(d: PD): StrategyAuthorization {
  const c = asConstr(d);
  if (c.tag === 0) return { kind: "Signature", signer: asBytes(c.fields[0]) };
  if (c.tag === 1) return { kind: "Script", scriptHash: asBytes(c.fields[0]) };
  throw new Error(`StrategyAuthorization: unexpected ctor ${c.tag}`);
}

// V3 Order union: Strategy(0), Swap(1), Deposit(2), Withdrawal(3), Donation(4), Record(5).
function parseOrderV3(d: PD): Order {
  const c = asConstr(d);
  switch (c.tag) {
    case 0: // Strategy { auth }
      return { kind: "Strategy", auth: parseStrategyAuth(c.fields[0]) };
    case 1: // Swap { offer, minReceived }
      return {
        kind: "Swap",
        offer: parseAssetTriple(c.fields[0]),
        minReceived: parseAssetTriple(c.fields[1]),
      };
    case 2: // Deposit { assets }
      return { kind: "Deposit", assets: parseAssetPairList(c.fields[0]) };
    case 3: // Withdrawal { amount }
      return { kind: "Withdrawal", lpAmount: parseAssetTriple(c.fields[0]) };
    case 4: // Donation { assets }
      return { kind: "Donation", assets: parseAssetPairList(c.fields[0]) };
    case 5: // Record { policy }
      return { kind: "Record", policy: parseAssetPair(c.fields[0]) };
    default:
      throw new Error(`Order: unexpected ctor ${c.tag}`);
  }
}

// Stableswap Order union: Strategy(0), Swap(1), Deposit(2), Withdrawal(3), Record(4).
// (No Donation variant; Record shifts down by one.)
function parseOrderStableswap(d: PD): Order {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return { kind: "Strategy", auth: parseStrategyAuth(c.fields[0]) };
    case 1:
      return {
        kind: "Swap",
        offer: parseAssetTriple(c.fields[0]),
        minReceived: parseAssetTriple(c.fields[1]),
      };
    case 2:
      return { kind: "Deposit", assets: parseAssetPairList(c.fields[0]) };
    case 3:
      return { kind: "Withdrawal", lpAmount: parseAssetTriple(c.fields[0]) };
    case 4:
      return { kind: "Record", policy: parseAssetPair(c.fields[0]) };
    default:
      throw new Error(`Stableswap Order: unexpected ctor ${c.tag}`);
  }
}

function parseAssetPairList(d: PD): [AssetAmount, AssetAmount] {
  const list = asList(d);
  if (list.length !== 2) throw new Error(`expected 2 asset entries`);
  return [parseAssetTriple(list[0]), parseAssetTriple(list[1])];
}

function parseOrderDatumWith(data: PD, parseOrder: (d: PD) => Order, label: string): V3OrderDatum {
  if (!isConstr(data)) throw new Error(`${label}: expected Constr`);
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`${label}: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 6) {
    throw new Error(`${label}: expected 6 fields, got ${c.fields.length}`);
  }
  return {
    poolIdent: asOptional(c.fields[0], asBytes),
    owner: parseMultisig(c.fields[1]),
    maxProtocolFee: asInt(c.fields[2]),
    destination: parseDestination(c.fields[3]),
    details: parseOrder(c.fields[4]),
    extension: c.fields[5],
  };
}

export function parseV3OrderDatum(data: PD): V3OrderDatum {
  return parseOrderDatumWith(data, parseOrderV3, "V3OrderDatum");
}

export function parseStableswapOrderDatum(data: PD): V3OrderDatum {
  return parseOrderDatumWith(data, parseOrderStableswap, "StableswapOrderDatum");
}

// --- SignedStrategyExecution ----------------------------------------------
//
// Both V3 and Stableswap wrap a `StrategyExecution` with an optional signature.
// V3 nests transactionId in a Constr; Stableswap stores it as a plain string.
// We accept both shapes.

export type IntervalBound =
  | { kind: "NegativeInfinity" }
  | { kind: "PositiveInfinity" }
  | { kind: "Finite"; time: bigint };

export interface ValidityRange {
  lowerBound: { bound: IntervalBound; isInclusive: boolean };
  upperBound: { bound: IntervalBound; isInclusive: boolean };
}

export interface StrategyExecution {
  txRef: { transactionId: string; outputIndex: bigint };
  validityRange: ValidityRange;
  details: Order;
}

export interface SignedStrategyExecution {
  execution: StrategyExecution;
  signature: string | null;
}

function parseBound(d: PD): IntervalBound {
  // PlutusTx: NegativeInfinity = ctor 0; Finite(t) = ctor 1; PositiveInfinity = ctor 2.
  const c = asConstr(d);
  if (c.tag === 0) return { kind: "NegativeInfinity" };
  if (c.tag === 1) {
    // Finite carries a single Int field.
    const inner = c.fields[0];
    // The field is sometimes a 1-tuple (List of length 1).
    if (isConstr(inner)) {
      // Some encodings wrap it in another Constr; accept both.
      return { kind: "Finite", time: asInt(inner) };
    }
    return { kind: "Finite", time: asInt(inner) };
  }
  if (c.tag === 2) return { kind: "PositiveInfinity" };
  throw new Error(`IntervalBound: unexpected ctor ${c.tag}`);
}

function parseValidityRange(d: PD): ValidityRange {
  const c = asConstr(d);
  if (c.tag !== 0 || c.fields.length !== 2) {
    throw new Error("ValidityRange: expected ctor 0 with 2 fields");
  }
  const parseSide = (s: PD) => {
    const inner = asConstr(s);
    if (inner.tag !== 0 || inner.fields.length !== 2) {
      throw new Error("Bound side: expected ctor 0 with 2 fields");
    }
    return {
      bound: parseBound(inner.fields[0]),
      isInclusive: parseBool(inner.fields[1]),
    };
  };
  return { lowerBound: parseSide(c.fields[0]), upperBound: parseSide(c.fields[1]) };
}

function parseBool(d: PD): boolean {
  const c = asConstr(d);
  if (c.tag === 0) return false;
  if (c.tag === 1) return true;
  throw new Error(`Bool: unexpected ctor ${c.tag}`);
}

function parseTxRef(d: PD): { transactionId: string; outputIndex: bigint } {
  const c = asConstr(d);
  if (c.tag !== 0 || c.fields.length !== 2) {
    throw new Error("TxRef: expected ctor 0 with 2 fields");
  }
  // V3 wraps the txId in a Constr; Stableswap uses plain bytes.
  const idField = c.fields[0];
  const transactionId = isConstr(idField) ? asBytes(asConstr(idField).fields[0]) : asBytes(idField);
  return { transactionId, outputIndex: asInt(c.fields[1]) };
}

function parseSignedStrategyExecutionWith(
  d: PD,
  parseOrder: (x: PD) => Order
): SignedStrategyExecution {
  const c = asConstr(d);
  if (c.tag !== 0 || c.fields.length !== 2) {
    throw new Error("SignedStrategyExecution: expected ctor 0 with 2 fields");
  }
  const exec = asConstr(c.fields[0]);
  if (exec.tag !== 0 || exec.fields.length !== 4) {
    throw new Error("StrategyExecution: expected ctor 0 with 4 fields");
  }
  const signature = asOptional(c.fields[1], asBytes);
  return {
    execution: {
      txRef: parseTxRef(exec.fields[0]),
      validityRange: parseValidityRange(exec.fields[1]),
      details: parseOrder(exec.fields[2]),
      // exec.fields[3] is `extensions` (opaque Data) — ignored.
    },
    signature,
  };
}

export function parseV3SignedStrategyExecution(d: PD): SignedStrategyExecution {
  return parseSignedStrategyExecutionWith(d, parseOrderV3);
}

export function parseStableswapSignedStrategyExecution(d: PD): SignedStrategyExecution {
  return parseSignedStrategyExecutionWith(d, parseOrderStableswap);
}

// --- Pool datum parsers ----------------------------------------------------

export interface V3PoolDatum {
  kind: "V3";
  identifier: string;
  assetA: { policyId: string; assetName: string };
  assetB: { policyId: string; assetName: string };
  circulatingLp: bigint;
  bidFeesPer10K: bigint;
  askFeesPer10K: bigint;
  feeManager: MultisigScript | null;
  marketOpenSlot: bigint;
  protocolFees: bigint;
}

export interface StableswapPoolDatum {
  kind: "Stableswap";
  identifier: string;
  assetA: { policyId: string; assetName: string };
  assetB: { policyId: string; assetName: string };
  circulatingLp: bigint;
  // (bidFee, askFee) each in parts per 10,000.
  lpBidFeesPer10K: bigint;
  lpAskFeesPer10K: bigint;
  protocolBidFeesPer10K: bigint;
  protocolAskFeesPer10K: bigint;
  feeManager: MultisigScript | null;
  marketOpenSlot: bigint;
  // (flat, perA, perB) protocol fees accumulator.
  protocolFeesFlat: bigint;
  protocolFeesA: bigint;
  protocolFeesB: bigint;
  linearAmplification: bigint;
  sumInvariant: bigint;
  linearAmplificationManager: MultisigScript | null;
}

export type SundaePoolDatum = V3PoolDatum | StableswapPoolDatum;

function parsePolicyAssetPair(d: PD): { policyId: string; assetName: string } {
  return parseAssetPair(d);
}

function parseAssetPairTuple(d: PD): [
  { policyId: string; assetName: string },
  { policyId: string; assetName: string }
] {
  const list = asList(d);
  if (list.length !== 2) throw new Error("expected 2 asset pairs");
  return [parsePolicyAssetPair(list[0]), parsePolicyAssetPair(list[1])];
}

function parseIntPair(d: PD): [bigint, bigint] {
  const list = asList(d);
  if (list.length !== 2) throw new Error("expected (num, denom) pair");
  return [asInt(list[0]), asInt(list[1])];
}

function parseIntTriple(d: PD): [bigint, bigint, bigint] {
  const list = asList(d);
  if (list.length !== 3) throw new Error("expected (a, b, c) triple");
  return [asInt(list[0]), asInt(list[1]), asInt(list[2])];
}

export function parseV3PoolDatum(data: PD): V3PoolDatum {
  if (!isConstr(data)) throw new Error("V3PoolDatum: expected Constr");
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`V3PoolDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 8) {
    throw new Error(`V3PoolDatum: expected 8 fields, got ${c.fields.length}`);
  }
  const [assetA, assetB] = parseAssetPairTuple(c.fields[1]);
  return {
    kind: "V3",
    identifier: asBytes(c.fields[0]),
    assetA,
    assetB,
    circulatingLp: asInt(c.fields[2]),
    bidFeesPer10K: asInt(c.fields[3]),
    askFeesPer10K: asInt(c.fields[4]),
    feeManager: asOptional(c.fields[5], parseMultisig),
    marketOpenSlot: asInt(c.fields[6]),
    protocolFees: asInt(c.fields[7]),
  };
}

export function parseStableswapPoolDatum(data: PD): StableswapPoolDatum {
  if (!isConstr(data)) throw new Error("StableswapPoolDatum: expected Constr");
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`StableswapPoolDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 11) {
    throw new Error(`StableswapPoolDatum: expected 11 fields, got ${c.fields.length}`);
  }
  const [assetA, assetB] = parseAssetPairTuple(c.fields[1]);
  const [lpBid, lpAsk] = parseIntPair(c.fields[3]);
  const [protoBid, protoAsk] = parseIntPair(c.fields[4]);
  const [feesFlat, feesA, feesB] = parseIntTriple(c.fields[7]);
  return {
    kind: "Stableswap",
    identifier: asBytes(c.fields[0]),
    assetA,
    assetB,
    circulatingLp: asInt(c.fields[2]),
    lpBidFeesPer10K: lpBid,
    lpAskFeesPer10K: lpAsk,
    protocolBidFeesPer10K: protoBid,
    protocolAskFeesPer10K: protoAsk,
    feeManager: asOptional(c.fields[5], parseMultisig),
    marketOpenSlot: asInt(c.fields[6]),
    protocolFeesFlat: feesFlat,
    protocolFeesA: feesA,
    protocolFeesB: feesB,
    linearAmplification: asInt(c.fields[8]),
    sumInvariant: asInt(c.fields[9]),
    linearAmplificationManager: asOptional(c.fields[10], parseMultisig),
  };
}

// --- Static validation ----------------------------------------------------

export interface SundaeIssue {
  severity: "error" | "warning" | "info";
  message: string;
}

export function validateV3OrderDatum(datum: V3OrderDatum): SundaeIssue[] {
  const issues: SundaeIssue[] = [];

  // poolIdent shape: must be 28 bytes (56 hex chars) when present.
  if (datum.poolIdent !== null && datum.poolIdent.length !== 56) {
    issues.push({
      severity: "warning",
      message: `Pool identifier should be 28 bytes (56 hex chars); got ${datum.poolIdent.length}`,
    });
  }

  // maxProtocolFee should be positive — a zero fee won't pay a scooper anything.
  if (datum.maxProtocolFee <= BigInt(0)) {
    issues.push({
      severity: "warning",
      message: `maxProtocolFee is ${datum.maxProtocolFee}; a positive lovelace value is expected`,
    });
  }

  // Swap-specific sanity checks.
  if (datum.details.kind === "Swap") {
    const { offer, minReceived } = datum.details;
    if (offer.amount <= BigInt(0)) {
      issues.push({ severity: "error", message: "Swap offer amount must be positive" });
    }
    if (minReceived.amount < BigInt(0)) {
      issues.push({ severity: "error", message: "Swap minReceived amount cannot be negative" });
    }
    if (
      offer.policyId === minReceived.policyId &&
      offer.assetName === minReceived.assetName
    ) {
      issues.push({
        severity: "error",
        message: "Swap offer and minReceived reference the same asset",
      });
    }
  }

  if (datum.details.kind === "Deposit" || datum.details.kind === "Donation") {
    const [a, b] = datum.details.assets;
    if (a.amount < BigInt(0) || b.amount < BigInt(0)) {
      issues.push({
        severity: "error",
        message: `${datum.details.kind} amounts cannot be negative`,
      });
    }
  }

  if (datum.details.kind === "Withdrawal" && datum.details.lpAmount.amount <= BigInt(0)) {
    issues.push({ severity: "error", message: "Withdrawal LP amount must be positive" });
  }

  return issues;
}
