import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  parseStrikeAgreementDatum,
  parseStrikeCollateralDatum,
  parseStrikeCollateralRedeemer,
  parseStrikeForwardsDatum,
  parseStrikeForwardsMintRedeemer,
  parseStrikeForwardsRedeemer,
} from "./forwards";
import {
  matchStrikeForwardsNftPolicy,
  matchStrikeForwardsScriptHash,
  STRIKE,
  STRIKE_FORWARDS,
} from "./constants";
import { getDexAdapter } from "@/utils/protocols/dex/registry";
// Importing the module registers the single combined Strike adapter.
import "./index";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });

const ISSUER = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const OBLIGEE = "aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffff000000001";
const POLICY = "11112222333344445555666677778888999900001111222233334444";
const NAME = "5354";

const ada: PD = C(0, B(""), B("")); // AssetClass = Constr0[#"", #""]
const usdm: PD = C(0, B(POLICY), B(NAME));
const FALSE: PD = C(0);
const TRUE: PD = C(1);

// ForwardsDatum: Constr0, 10 fields.
const forwardsDatum: PD = C(
  0,
  B(ISSUER), // 0 issuer_address_hash
  ada, // 1 issuer_deposit_asset
  I(100_000_000), // 2 issuer_deposit_asset_amount
  usdm, // 3 obligee_deposit_asset
  I(50_000_000), // 4 obligee_deposit_asset_amount
  ada, // 5 collateral_asset
  I(10_000_000), // 6 each_party_collateral_asset_amount
  I(1_000_000), // 7 each_party_strike_collateral_asset_amount
  I(0x196c27bca75), // 8 exercise_contract_date (settlement, ms)
  B(POLICY), // 9 mint_asset_policy_id
);

describe("parseStrikeForwardsDatum", () => {
  test("parses all 10 fields", () => {
    const f = parseStrikeForwardsDatum(forwardsDatum);
    expect(f.issuerAddressHash).toBe(ISSUER);
    expect(f.issuerDepositAsset).toEqual({ policyId: "", assetName: "" });
    expect(f.issuerDepositAssetAmount).toBe(BigInt(100_000_000));
    expect(f.obligeeDepositAsset).toEqual({ policyId: POLICY, assetName: NAME });
    expect(f.obligeeDepositAssetAmount).toBe(BigInt(50_000_000));
    expect(f.eachPartyCollateralAssetAmount).toBe(BigInt(10_000_000));
    expect(f.eachPartyStrikeCollateralAssetAmount).toBe(BigInt(1_000_000));
    expect(f.exerciseContractDate).toBe(BigInt(0x196c27bca75));
    expect(f.mintAssetPolicyId).toBe(POLICY);
  });

  test("rejects wrong field count", () => {
    expect(() => parseStrikeForwardsDatum(C(0, B(ISSUER)))).toThrow();
  });
});

describe("parseStrikeCollateralDatum / parseStrikeAgreementDatum", () => {
  test("CollateralDatum Constr0, 4 fields, bools + nested ForwardsDatum", () => {
    const datum: PD = C(0, TRUE, B(OBLIGEE), FALSE, forwardsDatum);
    const col = parseStrikeCollateralDatum(datum);
    expect(col.issuerHasDepositedAsset).toBe(true);
    expect(col.obligeeAddressHash).toBe(OBLIGEE);
    expect(col.obligeeHasDepositedAsset).toBe(false);
    expect(col.associatedForwardsDatum.issuerAddressHash).toBe(ISSUER);
  });

  test("AgreementDatum Constr0, 2 fields, nested ForwardsDatum", () => {
    const datum: PD = C(0, B(OBLIGEE), forwardsDatum);
    const ag = parseStrikeAgreementDatum(datum);
    expect(ag.utxoOwnerAddressHash).toBe(OBLIGEE);
    expect(ag.associatedForwardsDatum.mintAssetPolicyId).toBe(POLICY);
  });
});

describe("forwards redeemers", () => {
  test("ForwardsRedeemer Accept (idx 0) / Cancel (idx 1)", () => {
    const accept = parseStrikeForwardsRedeemer(C(0, B(OBLIGEE), I(3)));
    if (accept.kind !== "AcceptForwardsContract") throw new Error("expected accept");
    expect(accept.counterpartyHash).toBe(OBLIGEE);
    expect(accept.index).toBe(BigInt(3));
    expect(parseStrikeForwardsRedeemer(C(1)).kind).toBe("CancelForwardsContract");
  });

  test("CollateralRedeemerAction variants with Party enum", () => {
    const one = parseStrikeCollateralRedeemer(C(0, C(0), I(2)));
    if (one.kind !== "OneSideDepositAgreement") throw new Error("expected one-side");
    expect(one.party).toBe("Issuer");
    expect(one.index).toBe(BigInt(2));

    const both = parseStrikeCollateralRedeemer(C(1, C(1)));
    if (both.kind !== "BothSidesDepositAgreement") throw new Error("expected both");
    expect(both.party).toBe("Obligee");

    const liq = parseStrikeCollateralRedeemer(C(2, C(0)));
    expect(liq.kind).toBe("LiquidateCollateral");

    const liqBoth = parseStrikeCollateralRedeemer(C(3, I(9)));
    if (liqBoth.kind !== "LiquidateBothParties") throw new Error("expected liq-both");
    expect(liqBoth.index).toBe(BigInt(9));
  });

  test("MintRedeemer 5 variants", () => {
    const create = parseStrikeForwardsMintRedeemer(C(0, I(1)));
    if (create.kind !== "CreateForwardMint") throw new Error("expected create");
    expect(create.index).toBe(BigInt(1));

    const enter = parseStrikeForwardsMintRedeemer(C(1, B(OBLIGEE), I(2)));
    if (enter.kind !== "EnterForwardMint") throw new Error("expected enter");
    expect(enter.counterpartyHash).toBe(OBLIGEE);

    expect(parseStrikeForwardsMintRedeemer(C(2, B(ISSUER))).kind).toBe("CancelForwardBurn");

    const liq = parseStrikeForwardsMintRedeemer(C(3, B(ISSUER), B(OBLIGEE)));
    if (liq.kind !== "LiquidateBurn") throw new Error("expected liquidate");
    expect(liq.issuerHash).toBe(ISSUER);
    expect(liq.obligeeHash).toBe(OBLIGEE);

    expect(parseStrikeForwardsMintRedeemer(C(4, B(ISSUER))).kind).toBe("ConsumeAgreementBurn");
  });
});

describe("Strike Forwards matching", () => {
  test("script hashes → forward-position, mainnet only", () => {
    expect(matchStrikeForwardsScriptHash(STRIKE_FORWARDS.forwardsHash, "mainnet")).toBe(
      "forward-position",
    );
    expect(matchStrikeForwardsScriptHash(STRIKE_FORWARDS.collateralHash, undefined)).toBe(
      "forward-position",
    );
    expect(matchStrikeForwardsScriptHash(STRIKE_FORWARDS.agreementHash, "mainnet")).toBe(
      "forward-position",
    );
    expect(matchStrikeForwardsScriptHash(STRIKE_FORWARDS.forwardsHash, "preprod")).toBeNull();
    expect(matchStrikeForwardsScriptHash(ISSUER, "mainnet")).toBeNull();
  });

  test("NFT policy: forward NFT requires STRIKE asset name under forwards policy", () => {
    expect(
      matchStrikeForwardsNftPolicy(
        STRIKE_FORWARDS.forwardsHash,
        [STRIKE_FORWARDS.forwardAssetName],
        "mainnet",
      ),
    ).toBe("forward-position");
    expect(matchStrikeForwardsNftPolicy(STRIKE_FORWARDS.forwardsHash, [NAME], "mainnet")).toBeNull();
    expect(
      matchStrikeForwardsNftPolicy(
        STRIKE_FORWARDS.forwardsHash,
        [STRIKE_FORWARDS.forwardAssetName],
        "preprod",
      ),
    ).toBeNull();
  });
});

describe("combined Strike adapter (single registration)", () => {
  const adapter = getDexAdapter("strike-finance");

  test("exactly one Strike adapter is registered, no separate forwards id", () => {
    expect(adapter).toBeDefined();
    expect(getDexAdapter("strike-forwards")).toBeUndefined();
  });

  test("matchScriptHash dispatches both perpetuals and forwards roles", () => {
    expect(adapter?.matchScriptHash?.(STRIKE.poolHash, "mainnet")).toBe("pool");
    expect(adapter?.matchScriptHash?.(STRIKE.managePositionsHash, "mainnet")).toBe("position");
    expect(adapter?.matchScriptHash?.(STRIKE_FORWARDS.forwardsHash, "mainnet")).toBe(
      "forward-position",
    );
    expect(adapter?.matchScriptHash?.(STRIKE_FORWARDS.agreementHash, "mainnet")).toBe(
      "forward-position",
    );
    expect(adapter?.matchScriptHash?.(ISSUER, "mainnet")).toBeNull();
  });

  test("matchNftPolicy dispatches the forward NFT", () => {
    expect(
      adapter?.matchNftPolicy?.(
        STRIKE_FORWARDS.forwardsHash,
        [STRIKE_FORWARDS.forwardAssetName],
        "mainnet",
      ),
    ).toBe("forward-position");
  });

  test("decode(forward-position, ForwardsDatum) → forwards view", () => {
    const view = adapter?.decode?.(forwardsDatum, "forward-position");
    expect(view?.protocol).toBe("Strike Finance (Forwards)");
    expect(view?.role).toBe("forward-position");
    expect(view?.kind).toBe("Forward contract");
  });

  test("decode(forward-position, CollateralDatum) → forward collateral view", () => {
    const datum: PD = C(0, TRUE, B(OBLIGEE), FALSE, forwardsDatum);
    const view = adapter?.decode?.(datum, "forward-position");
    expect(view?.kind).toBe("Forward collateral");
  });

  test("decode(forward-position, AgreementDatum) → forward agreement view", () => {
    const datum: PD = C(0, B(OBLIGEE), forwardsDatum);
    const view = adapter?.decode?.(datum, "forward-position");
    expect(view?.kind).toBe("Forward agreement");
  });

  test("classifyRedeemer routes forward-position to the forwards classifier", () => {
    expect(adapter?.classifyRedeemer?.(C(1), "forward-position")).toBe(
      "Cancel forwards contract",
    );
    expect(adapter?.classifyRedeemer?.(C(0, B(OBLIGEE), I(3)), "forward-position")).toBe(
      "Accept forwards contract",
    );
    expect(adapter?.classifyRedeemer?.(C(3, I(9)), "forward-position")).toBe(
      "Liquidate both parties",
    );
  });
});
