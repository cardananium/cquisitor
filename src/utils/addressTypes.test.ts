import { describe, expect, test } from "bun:test";
import { primeAddresses, readDecodedAddress } from "@/lib/decodedAddresses";
import { stakeCredentialOf, type DecodedAddress } from "./addressTypes";

describe("stakeCredentialOf", () => {
  test("a reward address reports the credential the decoder puts in payment_cred", () => {
    const decoded: DecodedAddress = {
      address_type: "Reward",
      details: { payment_cred: { type: "ScriptHash", credential: "abcd" } },
    };
    expect(stakeCredentialOf(decoded)).toEqual({ type: "ScriptHash", credential: "abcd" });
  });

  test("an address carrying both parts reports the staking half, not the payment half", () => {
    const decoded: DecodedAddress = {
      address_type: "Base",
      details: {
        payment_cred: { type: "ScriptHash", credential: "1111" },
        staking_cred: { type: "KeyHash", credential: "2222" },
      },
    };
    expect(stakeCredentialOf(decoded)).toEqual({ type: "KeyHash", credential: "2222" });
  });

  test("an address with no staking part has no stake credential", () => {
    const enterprise: DecodedAddress = {
      address_type: "Enterprise",
      details: { payment_cred: { type: "KeyHash", credential: "3333" } },
    };
    expect(stakeCredentialOf(enterprise)).toBeNull();
    expect(stakeCredentialOf(null)).toBeNull();
    expect(stakeCredentialOf(undefined)).toBeNull();
  });
});

describe("stakeCredentialOf over addresses the library decoded", () => {
  // A withdrawal key is a reward address, and the card that renders one labels
  // it Script or Key from this reading. Both addresses are real mainnet reward
  // addresses, so the shape asserted here is the library's own, not a mock.
  const scriptReward = "stake17xt0tsd7ug6gzv6l7jhvuvh7rhap4fq2j39xd5kkahy6nfg8vjx3m";
  const keyReward = "stake1uyrx65wjqjgeeksd8hptmcgl5jfyrqkfq0xe8xlp367kphsckq250";

  test("a script reward address reads as a script credential", async () => {
    await primeAddresses([scriptReward]);
    const decoded = readDecodedAddress(scriptReward);
    expect(decoded).toBeTruthy();
    expect(decoded!.address_type).toBe("Reward");
    // The reading this replaced looked at staking_cred, which a reward address
    // never carries, so every withdrawal was labelled Key.
    expect(decoded!.details.staking_cred).toBeUndefined();
    expect(stakeCredentialOf(decoded)).toEqual({
      type: "ScriptHash",
      credential: "96f5c1bee23481335ff4aece32fe1dfa1aa40a944a66d2d6edc9a9a5",
    });
  });

  test("a key reward address reads as a key credential", async () => {
    await primeAddresses([keyReward]);
    const decoded = readDecodedAddress(keyReward);
    expect(decoded).toBeTruthy();
    expect(decoded!.address_type).toBe("Reward");
    expect(stakeCredentialOf(decoded)).toEqual({
      type: "KeyHash",
      credential: "066d51d204919cda0d3dc2bde11fa4924182c903cd939be18ebd60de",
    });
  });
});
