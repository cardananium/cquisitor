// MuesliSwap datum/redeemer parsers.
//
// MuesliSwap is a HYBRID DEX with two on-chain surfaces, each with its own
// datum/redeemer family. Constructor indices + field order below are read
// VERBATIM from the authoritative committed sources:
//   - SURFACE A (order-book, Plutus V1):
//       OrderValidator.hs (`PlutusTx.unstableMakeIsData`, every type is
//       single-constructor → all index 0).
//   - SURFACE B (AMM, Plutus V2):
//       ConstantProductPool/Types.hs + BatchOrder/Types.hs
//       (`PlutusTx.makeIsDataIndexed` with explicit indices).
//
// (CurrencySymbol, TokenName) tuples compile to a 2-field Constr 0
// [policy, name] — that is exactly the shared `parseAssetClass` shape. ADA is
// ("", "").
//
// BOTH deployed order-book validators carry the SAME strict 4-field Order
// datum — there is no richer trailing-field layout at either committed hash.
//   - orderBookV11Hash 15b95f… (plutusV1): the datum decodes as
//     Constr 0 [ Constr 0 [ creator, buyCurrency, buyToken, buyAmount ] ].
//     The validator reads exactly those 4 fields (un_b_data ×3 + un_i_data) and
//     `fail "PT1"`s on any other shape — it does NOT inspect any 5th+ field.
//   - orderBookV1Hash ea184d… (plutusV1, legacy): the IDENTICAL 4-field read.
// `parseOrderBookDatum` therefore decodes the 4 real fields; `extraFields`
// stays as a defensive forward-compat passthrough for any future redeploy and
// is never populated at the V1.1 / V1 hashes.
//
//   - SURFACE A2 (order-book V2 PRODUCTION, Plutus V2):
//       orderBookV2Hash 00fb107b… (plutusV2). This is the richer escrow: a
//       2-deep wrapper
//       Constr 0 [ Constr 0 [ <8 fields> ] ] whose inner Order record is
//         [0] creator       : Address (Plutus V2 Constr 0 [paymentCred, Option<stake>])
//         [1] buyCurrency   : CurrencySymbol bytes ("" = ADA)
//         [2] buyToken      : TokenName bytes
//         [3] sellCurrency  : CurrencySymbol bytes ("" = ADA)
//         [4] sellToken     : TokenName bytes
//         [5] buyAmount     : Int (amount of the buy asset the order wants)
//         [6] allowPartial  : Bool  (Constr 0 [] = False, Constr 1 [] = True;
//                              both values observed live)
//         [7] lovelaceAttached : Int (ADA carried by the order UTxO; live min
//                              2_650_000)
//       The matchmaker spend redeemer is the bare Constr 0 [] (FullMatch); the
//       matchmaker carries a LICENSE NFT under policy 5817c34e… (the v2.2
//       matchmaker license).

import {
  asBool,
  asBytes,
  asConstr,
  asInt,
  asOptional,
  parseAssetClass,
  parsePlutusAddress,
  type AssetClass,
  type PD,
  type PlutusAddress,
} from "@/utils/protocols/dex/plutusData";

// ===========================================================================
// SURFACE A — ORDER-BOOK (Plutus V1)
// ===========================================================================

// A1. OrderDatum = Constr 0 [ Order ], where
//     Order = Constr 0 [ oCreator, oBuyCurrency, oBuyToken, oBuyAmount ].
export interface MuesliOrderBookDatum {
  surface: "order-book";
  creator: string; // PubKeyHash (28 bytes hex)
  buyCurrency: string; // CurrencySymbol; "" = ADA
  buyToken: string; // TokenName
  buyAmount: bigint;
  /**
   * Defensive forward-compat passthrough. Every deployed order-book datum is
   * exactly the 4-field layout above, so this is ALWAYS empty today. Anything
   * past the known 4 fields (only possible after a future validator redeploy)
   * is preserved here untouched rather than dropped.
   */
  extraFields: PD[];
}

export function parseOrderBookDatum(data: PD): MuesliOrderBookDatum {
  const outer = asConstr(data);
  if (outer.tag !== 0) {
    throw new Error(`MuesliSwap OrderDatum: unexpected outer ctor ${outer.tag}`);
  }
  if (outer.fields.length !== 1) {
    throw new Error(
      `MuesliSwap OrderDatum: expected 1 wrapped field, got ${outer.fields.length}`,
    );
  }
  const order = asConstr(outer.fields[0]);
  if (order.tag !== 0) {
    throw new Error(`MuesliSwap Order: unexpected ctor ${order.tag}`);
  }
  const f = order.fields;
  if (f.length < 4) {
    throw new Error(`MuesliSwap Order: expected ≥4 fields, got ${f.length}`);
  }
  return {
    surface: "order-book",
    creator: asBytes(f[0]),
    buyCurrency: asBytes(f[1]),
    buyToken: asBytes(f[2]),
    buyAmount: asInt(f[3]),
    extraFields: f.slice(4),
  };
}

// A2. OrderAction redeemer — bare Constr, no fields:
//     CancelOrder = Constr 0 [], FullMatch = Constr 1 [].
export type MuesliOrderBookAction = "CancelOrder" | "FullMatch";

export function classifyOrderBookRedeemer(data: PD): MuesliOrderBookAction | null {
  const c = asConstr(data);
  if (c.fields.length !== 0) return null;
  if (c.tag === 0) return "CancelOrder";
  if (c.tag === 1) return "FullMatch";
  return null;
}

// ===========================================================================
// SURFACE A2 — ORDER-BOOK V2 PRODUCTION (Plutus V2, hash 00fb107b…)
// ===========================================================================

// A2-1. OrderDatum = Constr 0 [ Order ], where the inner Order record is the
// 8-field layout documented in the module header.
export interface MuesliOrderBookV2Datum {
  surface: "order-book-v2";
  creator: PlutusAddress;
  buyCurrency: string; // CurrencySymbol; "" = ADA
  buyToken: string; // TokenName
  sellCurrency: string; // CurrencySymbol; "" = ADA
  sellToken: string; // TokenName
  buyAmount: bigint; // amount of the buy asset the order wants
  allowPartial: boolean; // Constr 0 [] = false, Constr 1 [] = true
  lovelaceAttached: bigint; // ADA carried by the order UTxO
}

export function parseMuesliOrderBookV2Datum(data: PD): MuesliOrderBookV2Datum {
  const outer = asConstr(data);
  if (outer.tag !== 0) {
    throw new Error(`MuesliSwap OrderV2 datum: unexpected outer ctor ${outer.tag}`);
  }
  if (outer.fields.length !== 1) {
    throw new Error(
      `MuesliSwap OrderV2 datum: expected 1 wrapped field, got ${outer.fields.length}`,
    );
  }
  const order = asConstr(outer.fields[0]);
  if (order.tag !== 0) {
    throw new Error(`MuesliSwap OrderV2: unexpected ctor ${order.tag}`);
  }
  const f = order.fields;
  if (f.length !== 8) {
    throw new Error(`MuesliSwap OrderV2: expected 8 fields, got ${f.length}`);
  }
  return {
    surface: "order-book-v2",
    creator: parsePlutusAddress(f[0]),
    buyCurrency: asBytes(f[1]),
    buyToken: asBytes(f[2]),
    sellCurrency: asBytes(f[3]),
    sellToken: asBytes(f[4]),
    buyAmount: asInt(f[5]),
    allowPartial: asBool(f[6]),
    lovelaceAttached: asInt(f[7]),
  };
}

// A2-2. OrderV2 spend redeemer — bare Constr, no fields. A matchmaker fill at
// 00fb107b… spends with Constr 0 [], so for the V2 validator Constr 0 is the
// (full/partial) MATCH action and Constr 1 is CancelOrder — the OPPOSITE index
// mapping from the V1 order-book (`classifyOrderBookRedeemer`, where Constr 0 is
// cancel). Hence a dedicated classifier here.
export type MuesliOrderBookV2Action = "Match" | "CancelOrder";

export function classifyOrderBookV2Redeemer(data: PD): MuesliOrderBookV2Action | null {
  const c = asConstr(data);
  if (c.fields.length !== 0) return null;
  if (c.tag === 0) return "Match";
  if (c.tag === 1) return "CancelOrder";
  return null;
}

// ===========================================================================
// SURFACE B — AMM POOL (Plutus V2)
// ===========================================================================

// B1. PoolDatum = Constr 0 [ pdCoinA, pdCoinB, pdTotalLiquidity, pdSwapFee ].
// The CLP (2nd AMM) variant appends 4 curve params (8 fields total).
export interface MuesliPoolDatum {
  surface: "pool";
  coinA: AssetClass;
  coinB: AssetClass;
  totalLiquidity: bigint;
  swapFee: bigint; // fee numerator, e.g. 30 ≈ 0.3%
  // CLP-only appended curve params (no published schema → kept neutral).
  clp?: { params: Array<{ num: bigint; den: bigint }>; tail: bigint };
}

export function parsePoolDatum(data: PD): MuesliPoolDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`MuesliSwap PoolDatum: unexpected ctor ${c.tag}`);
  const f = c.fields;
  if (f.length < 4) {
    throw new Error(`MuesliSwap PoolDatum: expected ≥4 fields, got ${f.length}`);
  }
  const base: MuesliPoolDatum = {
    surface: "pool",
    coinA: parseAssetClass(f[0]),
    coinB: parseAssetClass(f[1]),
    totalLiquidity: asInt(f[2]),
    swapFee: asInt(f[3]),
  };
  if (f.length >= 8) {
    try {
      const rat = (x: PD) => {
        const cc = asConstr(x);
        return { num: asInt(cc.fields[0]), den: asInt(cc.fields[1]) };
      };
      base.clp = { params: [rat(f[4]), rat(f[5]), rat(f[6])], tail: asInt(f[7]) };
    } catch {
      // not the CLP shape
    }
  }
  return base;
}

// B2. PoolRedeemer:
//     ApplyPool  = Constr 0 [ apBatcherAddress : Address, apLicenseIndex : Int ]
//     DirectSwap = Constr 1 [ dsLicenseIndex : Int ]
export type MuesliPoolRedeemer =
  | { kind: "ApplyPool"; batcherAddress: PlutusAddress; licenseIndex: bigint }
  | { kind: "DirectSwap"; licenseIndex: bigint };

export function parsePoolRedeemer(data: PD): MuesliPoolRedeemer {
  const c = asConstr(data);
  if (c.tag === 0) {
    if (c.fields.length < 2) {
      throw new Error(`MuesliSwap ApplyPool: expected 2 fields, got ${c.fields.length}`);
    }
    return {
      kind: "ApplyPool",
      batcherAddress: parsePlutusAddress(c.fields[0]),
      licenseIndex: asInt(c.fields[1]),
    };
  }
  if (c.tag === 1) {
    if (c.fields.length < 1) {
      throw new Error(`MuesliSwap DirectSwap: expected 1 field, got ${c.fields.length}`);
    }
    return { kind: "DirectSwap", licenseIndex: asInt(c.fields[0]) };
  }
  throw new Error(`MuesliSwap PoolRedeemer: unexpected ctor ${c.tag}`);
}

export function classifyPoolRedeemer(data: PD): "ApplyPool" | "DirectSwap" | null {
  try {
    return parsePoolRedeemer(data).kind;
  } catch {
    return null;
  }
}

// B5. OrderStep (nested inside the batch-order datum):
//     Deposit        = Constr 0 [ dMinimumLP ]
//     Withdraw       = Constr 1 [ wMinimumCoinA, wMinimumCoinB ]
//     OneSideDeposit = Constr 2 [ osdDesiredCoin (AssetClass), osdMinimumLP ]
export type MuesliOrderStep =
  | { kind: "Deposit"; minimumLP: bigint }
  | { kind: "Withdraw"; minimumCoinA: bigint; minimumCoinB: bigint }
  | { kind: "OneSideDeposit"; desiredCoin: AssetClass; minimumLP: bigint };

export function parseOrderStep(data: PD): MuesliOrderStep {
  const c = asConstr(data);
  if (c.tag === 0) {
    if (c.fields.length < 1) throw new Error("MuesliSwap Deposit: expected 1 field");
    return { kind: "Deposit", minimumLP: asInt(c.fields[0]) };
  }
  if (c.tag === 1) {
    if (c.fields.length < 2) throw new Error("MuesliSwap Withdraw: expected 2 fields");
    return {
      kind: "Withdraw",
      minimumCoinA: asInt(c.fields[0]),
      minimumCoinB: asInt(c.fields[1]),
    };
  }
  if (c.tag === 2) {
    if (c.fields.length < 2) throw new Error("MuesliSwap OneSideDeposit: expected 2 fields");
    return {
      kind: "OneSideDeposit",
      desiredCoin: parseAssetClass(c.fields[0]),
      minimumLP: asInt(c.fields[1]),
    };
  }
  throw new Error(`MuesliSwap OrderStep: unexpected ctor ${c.tag}`);
}

// B3. Batch-order (liquidity) OrderDatum. At batchOrderHash 73ede893…, TWO
// field layouts coexist on-chain at the same address:
//   - Current: Constr 0 [
//       odSender, odReceiver, odReceiverDatumHash (Maybe), odStep (OrderStep),
//       odBatcherFee, odOutputADA, odPoolNftTokenName (bytes),
//       odScriptVersion (bytes "MuesliSwap_AMM") ].
//   - Legacy: the SAME datum WITHOUT odPoolNftTokenName — Constr 0 [
//       odSender, odReceiver, odReceiverDatumHash (Maybe), odStep,
//       odBatcherFee, odOutputADA, odScriptVersion ] (7 fields).
// In BOTH layouts the LAST field is the bytes script version; the pool NFT
// token name is the OPTIONAL trailing field present only in the 8-field form.
// The previous parser hard-required ≥8 fields and threw on the legacy 7-field
// datum. We now accept either, leaving poolNftTokenName null when absent.
export interface MuesliBatchOrderDatum {
  surface: "batch-order";
  sender: PlutusAddress;
  receiver: PlutusAddress;
  receiverDatumHash: string | null;
  step: MuesliOrderStep;
  batcherFee: bigint;
  outputADA: bigint;
  /** Null on the legacy 7-field on-chain layout (no odPoolNftTokenName). */
  poolNftTokenName: string | null;
  scriptVersion: string;
}

export function parseBatchOrderDatum(data: PD): MuesliBatchOrderDatum {
  const c = asConstr(data);
  if (c.tag !== 0) {
    throw new Error(`MuesliSwap batch OrderDatum: unexpected ctor ${c.tag}`);
  }
  const f = c.fields;
  if (f.length !== 7 && f.length !== 8) {
    throw new Error(
      `MuesliSwap batch OrderDatum: expected 7 or 8 fields, got ${f.length}`,
    );
  }
  // The pool NFT token name is the optional trailing field present only in the
  // 8-field layout; the script version is always the final field.
  const hasPoolNft = f.length === 8;
  return {
    surface: "batch-order",
    sender: parsePlutusAddress(f[0]),
    receiver: parsePlutusAddress(f[1]),
    // Maybe DatumHash: Constr 0 [hash] = Just / Constr 1 [] = Nothing.
    receiverDatumHash: asOptional(f[2], asBytes),
    step: parseOrderStep(f[3]),
    batcherFee: asInt(f[4]),
    outputADA: asInt(f[5]),
    poolNftTokenName: hasPoolNft ? asBytes(f[6]) : null,
    scriptVersion: asBytes(hasPoolNft ? f[7] : f[6]),
  };
}

// B4. OrderRedeemer — bare Constr, no fields:
//     ApplyOrder = Constr 0 [], CancelOrder = Constr 1 [].
export type MuesliBatchOrderAction = "ApplyOrder" | "CancelOrder";

export function classifyBatchOrderRedeemer(data: PD): MuesliBatchOrderAction | null {
  const c = asConstr(data);
  if (c.fields.length !== 0) return null;
  if (c.tag === 0) return "ApplyOrder";
  if (c.tag === 1) return "CancelOrder";
  return null;
}
