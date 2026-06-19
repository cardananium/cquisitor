import { describe, test, expect } from "bun:test";
import "@/utils/protocols/dex/adapters";
import { detectDexWithdrawal } from "./detect";

// Real mainnet batcher reward addresses (withdraw-zero staking validators).
const SUNDAE = "stake17xv7t2k0gq076r4su2vn6uk5yw287s35968cfq6n6ql0ucgumd727";
const WINGRIDERS = "stake17xt0tsd7ug6gzv6l7jhvuvh7rhap4fq2j39xd5kkahy6nfg8vjx3m";
// Minswap V2 batcher as a hex reward address (header f1 = script stake cred).
const MINSWAP_HEX = "f1" + "1eae96baf29e27682ea3f815aba361a0c6059d45e4bfbe95bbd2f44a";
// A key-credential stake address (not a script) — never a DEX batcher.
const KEY_STAKE = "stake1uxnchx8j5y4l5zv8ywxs2ttuw6hpw4xmcs8z3vm8as3xnequc8z2j";

describe("detectDexWithdrawal — withdraw-zero batchers", () => {
  test("recognizes the SundaeSwap V3 scooper", () => {
    expect(detectDexWithdrawal(SUNDAE, "mainnet")).toMatchObject({ label: "SundaeSwap", purpose: "scooper (batch validator)" });
  });
  test("recognizes the WingRiders V2 batcher", () => {
    expect(detectDexWithdrawal(WINGRIDERS, "mainnet")).toMatchObject({ label: "WingRiders", purpose: "batch validator" });
  });
  test("recognizes the Minswap V2 batcher", () => {
    expect(detectDexWithdrawal(MINSWAP_HEX, "mainnet")).toMatchObject({ label: "Minswap", purpose: "batch validator" });
  });
  test("is network-aware: the mainnet batcher does not match on preprod", () => {
    expect(detectDexWithdrawal(WINGRIDERS, "preprod")).toBeNull();
  });
  test("ignores a key-credential (non-script) withdrawal", () => {
    expect(detectDexWithdrawal(KEY_STAKE, "mainnet")).toBeNull();
  });
});
