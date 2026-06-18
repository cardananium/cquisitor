import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  formatBidApy,
  parseBatchStakeDatum,
  parseBatchStakeRedeemer,
  parseCollateralAmoDatum,
  parseCollateralAmoRedeemer,
  parseIdMintRedeemer,
  parseOptimPositionDatum,
  parseSotokenMintRedeemer,
  parseStakeAuctionBidDatum,
  parseStakingAmoDatum,
  parseStrategyDatum,
  validateBatchStake,
  validateStakeAuctionBid,
  validateStakingAmo,
} from "./datums";
import { matchOptimScriptHash, OPTIM, optimTokenForPolicy } from "./constants";
import { optimDatumToView } from "./index";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });

const OWNER = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const STAKE = "aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffff000000001";
const POLICY = "11112222333344445555666677778888999900001111222233334444";
const NAME = "534f414441";
const SCRIPT = "56b2791d0123456789abcdef0123456789abcdef0123456789abcdef";

// Address = Constr0[ Credential, Some(Inline(Credential)) ]
const addr: PD = C(0, C(0, B(OWNER)), C(0, C(0, C(0, B(STAKE)))));
const addrNoStake: PD = C(0, C(1, B(SCRIPT)), C(1));
const assetClass: PD = C(0, B(POLICY), B(NAME));

describe("parseBatchStakeDatum", () => {
  const datum: PD = C(0, B(OWNER), addr);

  test("parses owner + return address", () => {
    const d = parseBatchStakeDatum(datum);
    expect(d.kind).toBe("BatchStake");
    expect(d.owner).toBe(OWNER);
    expect(d.returnAddress.paymentCredential).toEqual({ kind: "VKey", hash: OWNER });
    expect(d.returnAddress.stakeCredential).toEqual({
      kind: "Inline",
      credential: { kind: "VKey", hash: STAKE },
    });
  });

  test("handles script payment + no stake", () => {
    const d = parseBatchStakeDatum(C(0, B(OWNER), addrNoStake));
    expect(d.returnAddress.paymentCredential).toEqual({ kind: "Script", hash: SCRIPT });
    expect(d.returnAddress.stakeCredential).toBeNull();
  });

  test("validation flags non-28-byte owner", () => {
    const bad = parseBatchStakeDatum(C(0, B("abcd"), addr));
    expect(validateBatchStake(bad).length).toBeGreaterThan(0);
    expect(validateBatchStake(parseBatchStakeDatum(datum))).toEqual([]);
  });
});

describe("parseBatchStakeRedeemer", () => {
  test("CancelStake = Constr0[]", () => {
    expect(parseBatchStakeRedeemer(C(0)).kind).toBe("CancelStake");
  });

  test("DigestStake with Some(continuing index)", () => {
    const r = parseBatchStakeRedeemer(C(1, I(2), C(0, I(7))));
    expect(r.kind).toBe("DigestStake");
    if (r.kind !== "DigestStake") throw new Error("expected DigestStake");
    expect(r.returnIndex).toBe(BigInt(2));
    expect(r.continuingOrderIndex).toBe(BigInt(7));
  });

  test("DigestStake with None", () => {
    const r = parseBatchStakeRedeemer(C(1, I(3), C(1)));
    if (r.kind !== "DigestStake") throw new Error("expected DigestStake");
    expect(r.continuingOrderIndex).toBeNull();
  });

  test("Constr0 with fields is NOT CancelStake (avoids sOADA-mint collision)", () => {
    expect(() => parseBatchStakeRedeemer(C(0, I(1), I(2)))).toThrow();
  });
});

// Deployed 15-field StakingAmoDatum, modelled on the live mainnet AMO UTxO:
//   soulToken(nft), 3200, ADA, OADA, 1, 1, sOTOKEN, False, False,
//   100, 0, feeClaimRule, scriptHash12, 0, 0
const SOUL = C(0, B("4dac450fb9d638adca0c4a490fa052b2fbec12bd6111a4d427a6879d"), B("6e6674"));
const ADA = C(0, B(""), B(""));
const OADA = C(0, B(OPTIM.oadaPolicyId), B(""));
const SOTOKEN = C(0, B("eca642e0b47e012b13c5a29f1389aa014f1827d850032a643a7fd5b8"), B("6c71"));
const FCRULE = "4b3459fd18a1dbabe207cd19c9951a9fac9f5c0f9c384e3d97efba26";

const stakingAmo15: PD = C(
  0,
  SOUL, // [0] soul token
  I(3200), // [1]
  ADA, // [2] base asset
  OADA, // [3] otoken
  I(1), // [4]
  I(1), // [5]
  SOTOKEN, // [6] sotoken
  C(0), // [7] flag false
  C(0), // [8] flag false
  I(100), // [9] odao fee
  I(0), // [10] fee component 2
  B(FCRULE), // [11] fee claim rule
  B(FCRULE), // [12] script hash
  I(0), // [13] sotoken amount snapshot
  I(0), // [14] sotoken backing snapshot
);

describe("parseStakingAmoDatum (deployed 15-field)", () => {
  test("parses 15 fields in order", () => {
    const d = parseStakingAmoDatum(stakingAmo15);
    expect(d.soulToken).toEqual({
      policyId: "4dac450fb9d638adca0c4a490fa052b2fbec12bd6111a4d427a6879d",
      assetName: "6e6674",
    });
    expect(d.baseAsset).toEqual({ policyId: "", assetName: "" });
    expect(d.otoken).toEqual({ policyId: OPTIM.oadaPolicyId, assetName: "" });
    expect(d.sotoken).toEqual({
      policyId: "eca642e0b47e012b13c5a29f1389aa014f1827d850032a643a7fd5b8",
      assetName: "6c71",
    });
    expect(d.field1).toBe(BigInt(3200));
    expect(d.odaoFee).toBe(BigInt(100));
    expect(d.feeComponent2).toBe(BigInt(0));
    expect(d.feeClaimRule).toBe(FCRULE);
    expect(d.scriptHash12).toBe(FCRULE);
    expect(d.flag7).toBe(false);
    expect(d.flag8).toBe(false);
    expect(d.sotokenAmount).toBe(BigInt(0));
    expect(d.sotokenBacking).toBe(BigInt(0));
    expect(validateStakingAmo(d)).toEqual([]);
  });

  test("rejects the old 8-field shape", () => {
    expect(() =>
      parseStakingAmoDatum(C(0, B(OPTIM.soadaPolicyId), I(1), I(1), I(1), I(0), I(0), assetClass, B(SCRIPT))),
    ).toThrow();
  });

  test("validation flags negative backing", () => {
    const d = parseStakingAmoDatum(
      C(0, SOUL, I(3200), ADA, OADA, I(1), I(1), SOTOKEN, C(0), C(0), I(100), I(0), B(FCRULE), B(FCRULE), I(0), I(-1)),
    );
    expect(validateStakingAmo(d).length).toBeGreaterThan(0);
  });
});

describe("parseStakeAuctionBidDatum (Epoch Stake Auction)", () => {
  // FULL bid: owner, stake cred, apy, bidType(Partial), Some(outRef)
  const outRef: PD = C(0, C(0, B(OWNER)), I(2));
  const fullBid: PD = C(0, B(OWNER), C(0, B(STAKE)), I(308), C(0), C(0, outRef));

  test("parses the 5-field full bid", () => {
    const d = parseStakeAuctionBidDatum(fullBid);
    if (d.kind !== "StakeAuctionBid") throw new Error("expected full bid");
    expect(d.owner).toBe(OWNER);
    expect(d.stakeCredential).toEqual({ kind: "VKey", hash: STAKE });
    expect(d.apy).toBe(BigInt(308));
    expect(d.bidType).toBe("Partial");
    expect(d.bidRef).toEqual({ transactionId: OWNER, outputIndex: BigInt(2) });
    expect(validateStakeAuctionBid(d)).toEqual([]);
  });

  test("Full bid type (ctor1 marker) + None bid ref", () => {
    const d = parseStakeAuctionBidDatum(C(0, B(OWNER), C(0, B(STAKE)), I(25), C(1), C(1)));
    if (d.kind !== "StakeAuctionBid") throw new Error("expected full bid");
    expect(d.bidType).toBe("Full");
    expect(d.bidRef).toBeNull();
  });

  test("parses the 1-field continuation bid (Constr 1)", () => {
    const d = parseStakeAuctionBidDatum(C(1, I(308)));
    if (d.kind !== "StakeAuctionBidCont") throw new Error("expected continuation");
    expect(d.apy).toBe(BigInt(308));
  });

  test("formatBidApy divides the raw APY by 10", () => {
    expect(formatBidApy(BigInt(308))).toBe("30.8%");
    expect(formatBidApy(BigInt(25))).toBe("2.5%");
  });
});

describe("parseCollateralAmoDatum + StrategyDatum", () => {
  test("collateral amo: base profit, staking amo id, child strategies", () => {
    const d = parseCollateralAmoDatum(C(0, I(42), assetClass, L(assetClass, assetClass)));
    expect(d.baseProfitUncommitted).toBe(BigInt(42));
    expect(d.stakingAmo).toEqual({ policyId: POLICY, assetName: NAME });
    expect(d.childStrategies.length).toBe(2);
  });

  test("strategy datum: base profit + opaque data", () => {
    const opaque = C(5, I(9));
    const d = parseStrategyDatum(C(0, I(7), opaque));
    expect(d.baseProfit).toBe(BigInt(7));
    expect(d.strategyData).toEqual(opaque);
  });

  test("strategy view surfaces the opaque strategy_data structure (not a dead label)", () => {
    const view = optimDatumToView(parseStrategyDatum(C(0, I(7), C(5, I(9), B(SCRIPT)))));
    const dataRow = view.rows.find((r) => r.label.startsWith("Strategy data"));
    expect(dataRow).toBeDefined();
    // it must describe the on-chain shape, never the old "opaque (raw Data)" string.
    expect(dataRow?.value).toContain("ctor 5");
    expect(dataRow?.value).not.toBe("opaque (raw Data)");
  });
});

describe("parseOptimPositionDatum discrimination", () => {
  test("15 fields -> StakingAmo", () => {
    const d = parseOptimPositionDatum(stakingAmo15);
    expect(d.kind).toBe("StakingAmo");
  });

  test("5 fields -> StakeAuctionBid", () => {
    const d = parseOptimPositionDatum(C(0, B(OWNER), C(0, B(STAKE)), I(308), C(0), C(1)));
    expect(d.kind).toBe("StakeAuctionBid");
  });

  test("Constr1 1 field -> StakeAuctionBidCont", () => {
    const d = parseOptimPositionDatum(C(1, I(308)));
    expect(d.kind).toBe("StakeAuctionBidCont");
  });

  test("3 fields -> CollateralAmo", () => {
    const d = parseOptimPositionDatum(C(0, I(1), assetClass, L()));
    expect(d.kind).toBe("CollateralAmo");
  });

  test("2 fields [Bytes, Address] -> BatchStake", () => {
    const d = parseOptimPositionDatum(C(0, B(OWNER), addr));
    expect(d.kind).toBe("BatchStake");
  });

  test("2 fields [Int, Data] -> Strategy", () => {
    const d = parseOptimPositionDatum(C(0, I(7), C(5, I(9))));
    expect(d.kind).toBe("Strategy");
  });

  test("non-zero ctor -> Unknown", () => {
    const d = parseOptimPositionDatum(C(3, I(1)));
    expect(d.kind).toBe("Unknown");
  });
});

// Optim Finance is a liquid-staking + epoch-stake-auction protocol: it has no
// AMM pool and no swap/limit order with a give/get pair. Every role is
// "position". In particular the Staking AMO datum parses a base asset (ADA) and
// the minted oToken (OADA), but that is a deposit/mint (liquid-staking /
// synthetic) relationship — "ADA / OADA" is NOT a tradable pair against this
// singleton rate-state UTxO, and a third asset (sOADA) also appears. So NO Optim
// view sets `view.pair`. These tests lock in that deliberate skip so a later
// edit can't quietly surface a misleading pair header.
describe("no Optim view surfaces a trading pair (view.pair)", () => {
  test("Staking AMO (base ADA vs minted OADA) does NOT set pair", () => {
    const view = optimDatumToView(parseStakingAmoDatum(stakingAmo15));
    expect(view.kind).toBe("Staking AMO (rate state)");
    expect(view.pair).toBeUndefined();
  });

  test("BatchStake / StakeAuctionBid / Collateral / Strategy all omit pair", () => {
    const views = [
      optimDatumToView(parseOptimPositionDatum(C(0, B(OWNER), addr))), // BatchStake
      optimDatumToView(parseOptimPositionDatum(C(0, B(OWNER), C(0, B(STAKE)), I(308), C(0), C(1)))), // bid
      optimDatumToView(parseOptimPositionDatum(C(1, I(308)))), // continuation bid
      optimDatumToView(parseOptimPositionDatum(C(0, I(1), assetClass, L()))), // CollateralAmo
      optimDatumToView(parseOptimPositionDatum(C(0, I(7), C(5, I(9))))), // Strategy
      optimDatumToView(parseOptimPositionDatum(C(3, I(1)))), // Unknown / structural
    ];
    for (const v of views) expect(v.pair).toBeUndefined();
  });
});

describe("redeemers: sOADA mint, collateral amo, id mint", () => {
  test("sOADA Mint tuple (backing, amount)", () => {
    const r = parseSotokenMintRedeemer(C(0, I(900_000), I(1_000_000)));
    expect(r.sotokenBacking).toBe(BigInt(900_000));
    expect(r.sotokenAmount).toBe(BigInt(1_000_000));
  });

  test("CollateralAmoRedeemer ctors", () => {
    expect(parseCollateralAmoRedeemer(C(0)).kind).toBe("UpdateStakingAmo");
    const outRef = C(0, C(0, B(OWNER)), I(1));
    const spawn = parseCollateralAmoRedeemer(C(1, B(SCRIPT), outRef));
    expect(spawn.kind).toBe("SpawnStrategy");
    if (spawn.kind !== "SpawnStrategy") throw new Error("expected SpawnStrategy");
    expect(spawn.scriptHash).toBe(SCRIPT);
    expect(spawn.outRef).toEqual({ transactionId: OWNER, outputIndex: BigInt(1) });
    expect(parseCollateralAmoRedeemer(C(2, assetClass)).kind).toBe("DespawnStrategy");
    expect(parseCollateralAmoRedeemer(C(3, assetClass)).kind).toBe("SyncStrategy");
    expect(parseCollateralAmoRedeemer(C(4)).kind).toBe("MergeStakingRate");
    expect(parseCollateralAmoRedeemer(C(5)).kind).toBe("MergeNewDeposits");
  });

  test("IdMintRedeemer MintId / BurnId", () => {
    const mint = parseIdMintRedeemer(C(0, C(0, C(0, B(OWNER)), I(0))));
    expect(mint.kind).toBe("MintId");
    expect(parseIdMintRedeemer(C(1)).kind).toBe("BurnId");
  });
});

describe("Optim matching", () => {
  test("matchScriptHash on the applied AMO + stake-auction + batch-stake hashes", () => {
    expect(matchOptimScriptHash(OPTIM.stakingAmoHash, "mainnet")).toBe("position");
    expect(matchOptimScriptHash(OPTIM.stakeAuctionHash, undefined)).toBe("position");
    expect(matchOptimScriptHash(OPTIM.batchStakeHash, "mainnet")).toBe("position");
    // back-compat alias still resolves
    expect(matchOptimScriptHash(OPTIM.stakeOrderHash, undefined)).toBe("position");
  });

  test("matchScriptHash rejects unrelated hashes, wrong network, and the OADA token policy", () => {
    expect(matchOptimScriptHash(POLICY, "mainnet")).toBeNull();
    expect(matchOptimScriptHash(OPTIM.stakingAmoHash, "preprod")).toBeNull();
    // The OADA token policy must NOT match — it is broadly held (false positives).
    expect(matchOptimScriptHash(OPTIM.oadaPolicyId, "mainnet")).toBeNull();
  });

  test("optimTokenForPolicy", () => {
    expect(optimTokenForPolicy(OPTIM.oadaPolicyId)).toBe("OADA");
    expect(optimTokenForPolicy(OPTIM.soadaPolicyId)).toBe("sOADA");
    expect(optimTokenForPolicy(POLICY)).toBeNull();
  });
});
