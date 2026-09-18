import { describe, test, expect } from "bun:test";
import {
  collectAddressStrings,
  primeAddresses,
  readDecodedAddress,
  requestAddress,
  subscribeDecodedAddresses,
} from "./decodedAddresses";
import { MAX_LIB_INPUT_BYTES } from "@/utils/inputBudget";

// Base (key/key), script reward, and hex enterprise — shapes DEX/Sundae detectors see.
const BASE_ADDRESS =
  "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x";
const SCRIPT_REWARD_ADDRESS = "stake17xt0tsd7ug6gzv6l7jhvuvh7rhap4fq2j39xd5kkahy6nfg8vjx3m";
const HEX_ENTERPRISE_ADDRESS = "71c3e28c36c3447315ba5a56f33da6a6ddc1770a876a8d9f0cb3a97c4c";

// Capture before priming: render path gets `undefined` until a decode exists.
const unknownBeforePriming = readDecodedAddress(BASE_ADDRESS);

await primeAddresses([
  BASE_ADDRESS,
  SCRIPT_REWARD_ADDRESS,
  HEX_ENTERPRISE_ADDRESS,
  "not-an-address",
]);

describe("decodedAddresses", () => {
  test("says nothing is known about an address before it is primed", () => {
    expect(unknownBeforePriming).toBeUndefined();
  });

  test("decodes a base address to both credentials", () => {
    const decoded = readDecodedAddress(BASE_ADDRESS);
    expect(decoded?.address_type).toBe("Base");
    expect(decoded?.details.payment_cred).toEqual({
      type: "KeyHash",
      credential: "9493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e",
    });
    expect(decoded?.details.staking_cred?.type).toBe("KeyHash");
  });

  test("puts a reward address's script credential in payment_cred", () => {
    const decoded = readDecodedAddress(SCRIPT_REWARD_ADDRESS);
    expect(decoded?.address_type).toBe("Reward");
    expect(decoded?.details.payment_cred).toEqual({
      type: "ScriptHash",
      credential: "96f5c1bee23481335ff4aece32fe1dfa1aa40a944a66d2d6edc9a9a5",
    });
  });

  test("decodes an address written as hex", () => {
    const decoded = readDecodedAddress(HEX_ENTERPRISE_ADDRESS);
    expect(decoded?.address_type).toBe("Enterprise");
    expect(decoded?.details.payment_cred?.credential).toBe(
      "c3e28c36c3447315ba5a56f33da6a6ddc1770a876a8d9f0cb3a97c4c",
    );
  });

  test("remembers a decode that produced nothing, rather than retrying it", () => {
    // `null` (not `undefined`): a failed decode must not be retried every render.
    expect(readDecodedAddress("not-an-address")).toBeNull();
  });

  test("answers input over the size budget without calling the library", async () => {
    const oversized = "addr1" + "0".repeat(MAX_LIB_INPUT_BYTES);
    await primeAddresses([oversized]);
    expect(readDecodedAddress(oversized)).toBeNull();
  });

  test("priming again does not repeat a decode already held", async () => {
    let announcements = 0;
    const stop = subscribeDecodedAddresses(() => {
      announcements++;
    });
    await primeAddresses([BASE_ADDRESS, SCRIPT_REWARD_ADDRESS]);
    stop();
    expect(announcements).toBe(0);
  });

  test("a requested address is decoded and announced", async () => {
    const address = "stake17xv7t2k0gq076r4su2vn6uk5yw287s35968cfq6n6ql0ucgumd727";
    const landed = new Promise<void>((resolve) => {
      const stop = subscribeDecodedAddresses(() => {
        if (readDecodedAddress(address) !== undefined) {
          stop();
          resolve();
        }
      });
    });
    requestAddress(address);
    expect(readDecodedAddress(address)).toBeUndefined();
    await landed;
    expect(readDecodedAddress(address)?.details.payment_cred?.type).toBe("ScriptHash");
  });
});

describe("collectAddressStrings", () => {
  test("finds addresses in values, in map keys, and nested", () => {
    const found = collectAddressStrings({
      body: {
        outputs: [{ address: BASE_ADDRESS, amount: { coin: "1" } }],
        withdrawals: { [SCRIPT_REWARD_ADDRESS]: "0" },
      },
    });
    expect(found).toContain(BASE_ADDRESS);
    expect(found).toContain(SCRIPT_REWARD_ADDRESS);
  });

  test("ignores strings that are not shaped like an address", () => {
    // Datum JSON, script hex, and a field named `address` must not be collected.
    const found = collectAddressStrings({
      datum: '{"constructor":0,"fields":[{"int":1}]}',
      script: "590a1b0100003233223232",
      address: null,
      stake_address: null,
    });
    expect(found).toEqual([]);
  });

  test("de-duplicates, so one address in many outputs is decoded once", () => {
    const found = collectAddressStrings([
      { address: BASE_ADDRESS },
      { address: BASE_ADDRESS },
    ]);
    expect(found).toEqual([BASE_ADDRESS]);
  });
});
