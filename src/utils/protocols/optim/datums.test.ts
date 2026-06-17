import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  parseBatchStakeDatum,
  parseBatchStakeRedeemer,
  parseCollateralAmoDatum,
  parseCollateralAmoRedeemer,
  parseIdMintRedeemer,
  parseOptimPositionDatum,
  parseSotokenMintRedeemer,
  parseStakingAmoDatum,
  parseStrategyDatum,
  validateBatchStake,
  validateStakingAmo,
} from "./datums";
import { matchOptimScriptHash, OPTIM, optimTokenForPolicy } from "./constants";

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

describe("parseStakingAmoDatum", () => {
  const datum: PD = C(
    0,
    B(OPTIM.soadaPolicyId), // sotoken
    I(1_000_000), // sotoken_amount
    I(900_000), // sotoken_backing
    I(5_000_000), // sotoken_limit
    I(100), // odao_fee
    I(50), // odao_sotoken
    assetClass, // fee_claimer
    B(SCRIPT), // fee_claim_rule
  );

  test("parses 8 fields in order", () => {
    const d = parseStakingAmoDatum(datum);
    expect(d.sotoken).toBe(OPTIM.soadaPolicyId);
    expect(d.sotokenAmount).toBe(BigInt(1_000_000));
    expect(d.sotokenBacking).toBe(BigInt(900_000));
    expect(d.feeClaimer).toEqual({ policyId: POLICY, assetName: NAME });
    expect(d.feeClaimRule).toBe(SCRIPT);
    expect(validateStakingAmo(d)).toEqual([]);
  });

  test("validation flags non-positive backing", () => {
    const d = parseStakingAmoDatum(
      C(0, B(OPTIM.soadaPolicyId), I(1), I(0), I(1), I(0), I(0), assetClass, B(SCRIPT)),
    );
    expect(validateStakingAmo(d).length).toBeGreaterThan(0);
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
});

describe("parseOptimPositionDatum discrimination", () => {
  test("8 fields -> StakingAmo", () => {
    const d = parseOptimPositionDatum(
      C(0, B(OPTIM.soadaPolicyId), I(1), I(1), I(1), I(0), I(0), assetClass, B(SCRIPT)),
    );
    expect(d.kind).toBe("StakingAmo");
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
  test("matchScriptHash on the applied AMO + order validator hashes", () => {
    expect(matchOptimScriptHash(OPTIM.stakingAmoHash, "mainnet")).toBe("position");
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
