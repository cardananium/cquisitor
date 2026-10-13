import { describe, expect, test } from "bun:test";
import { buildBookIndex, buildRegistryIndex, matchAddress, matchScriptHash } from "./lookup";
import { parseScriptIndex } from "./registryData";
import type { AddressBookEntry } from "./types";

// Shaped like addresses, not valid bech32: the lookup compares strings and
// takes the credential from its caller, so nothing here is decoded.
const MINE = "addr1qy8ac7qqy0vtulyl7wntmsxc6wex80akj3nw3dmh3qpz0j9qxh2";
const MY_CRED = "aa11bb22cc33dd44ee55ff6677889900112233445566778899aabbcc";
const OTHER = "addr1q9m4p2vkc7tt8hh2v3gq8r9zfdcgk5xhsdt0y7n6lsq4rfdmzqw";
const OTHER_CRED = "ffeeddccbbaa99887766554433221100ffeeddccbbaa998877665544";

/** Same head as MINE, different tail. */
const GROUND = "addr1qy8ac7qqy0vtulyl7wntmsxc6wex80akj3nw3dmh3qpz0j9zzzz";
const GROUND_CRED = "0011223344556677889900112233445566778899001122334455667f";

const entry = (over: Partial<AddressBookEntry> = {}): AddressBookEntry => ({
  id: "e1",
  label: "My cold wallet",
  address: MINE,
  cred: MY_CRED,
  credType: "KeyHash",
  addedAt: 1_700_000_000_000,
  ...over,
});

const REGISTRY = parseScriptIndex(
  {
    metadata: { generatedAt: "2026-06-05T12:51:34.269Z" },
    projects: { "sundae-swap": { label: "SundaeSwap", category: "DEFI", subCategory: "AMM_DEX" } },
    scripts: {
      "4020e7fc2de75a0729c3cc3af715b34d98381e0cdbcfa99c950bc3ac": [
        "sundae-swap",
        "Liquidity Pool",
        "SPEND",
      ],
      // The registry also keys an address: payment hash plus stake hash.
      "1111111111111111111111111111111111111111111111111111111122222222222222222222222222222222222222222222222222222222":
        ["sundae-swap", "Pinned order address", "SPEND"],
    },
  },
  "snapshot",
)!;

const registryIndex = buildRegistryIndex(REGISTRY);

describe("the book answers first", () => {
  test("the saved address is known by its string", () => {
    const match = matchAddress(MINE, MY_CRED, buildBookIndex([entry()]), registryIndex);
    expect(match).toEqual({ kind: "known", entry: entry(), via: "address" });
  });

  test("another address with the saved payment credential is known by that credential", () => {
    const match = matchAddress(OTHER, MY_CRED, buildBookIndex([entry()]), registryIndex);
    expect(match?.kind).toBe("known");
    expect(match && match.kind === "known" ? match.via : null).toBe("cred");
  });

  test("an entry saved without a credential claims only its own address", () => {
    const book = buildBookIndex([entry({ cred: undefined, credType: undefined })]);
    expect(matchAddress(OTHER, MY_CRED, book, registryIndex)).toBeNull();
  });

  test("the book beats the registry for the same credential", () => {
    const pool = "4020e7fc2de75a0729c3cc3af715b34d98381e0cdbcfa99c950bc3ac";
    const book = buildBookIndex([entry({ address: undefined, cred: pool, label: "my own name" })]);
    const match = matchAddress(OTHER, pool, book, registryIndex);
    expect(match?.kind).toBe("known");
  });
});

describe("the registry names a script", () => {
  test("the payment script hash gets the project and the script name", () => {
    const match = matchAddress(
      OTHER,
      "4020e7fc2de75a0729c3cc3af715b34d98381e0cdbcfa99c950bc3ac",
      null,
      registryIndex,
    );
    expect(match?.kind).toBe("registry");
    if (match?.kind !== "registry") throw new Error("expected a registry match");
    expect(match.project?.label).toBe("SundaeSwap");
    expect(match.script.name).toBe("Liquidity Pool");
    expect(match.via).toBe("payment");
    expect(match.source).toBe("snapshot");
  });

  test("an address keyed with its stake part matches on both parts", () => {
    const payment = "1".repeat(56);
    const stake = "2".repeat(56);
    const match = matchAddress(OTHER, payment, null, registryIndex, stake);
    expect(match?.kind).toBe("registry");
    if (match?.kind !== "registry") throw new Error("expected a registry match");
    expect(match.via).toBe("pair");
  });

  test("the payment script still matches when the delegation part differs", () => {
    const match = matchAddress(OTHER, "1".repeat(56), null, registryIndex, "3".repeat(56));
    expect(match?.kind).toBe("registry");
    if (match?.kind !== "registry") throw new Error("expected a registry match");
    expect(match.via).toBe("payment");
  });

  test("a hash on its own resolves through the same index", () => {
    expect(matchScriptHash("4020E7FC2DE75A0729C3CC3AF715B34D98381E0CDBCFA99C950BC3AC", registryIndex)?.name).toBe(
      "Liquidity Pool",
    );
    expect(matchScriptHash("0".repeat(56), registryIndex)).toBeNull();
  });
});

describe("a lookalike is reported last", () => {
  test("an address that starts like a saved one is flagged against it", () => {
    const match = matchAddress(GROUND, GROUND_CRED, buildBookIndex([entry()]), registryIndex);
    expect(match?.kind).toBe("lookalike");
    if (match?.kind !== "lookalike") throw new Error("expected a lookalike");
    expect(match.field).toBe("address");
    expect(match.target.label).toBe("My cold wallet");
    expect(match.target.origin).toBe("book");
    expect(match.text).toBe(GROUND);
    expect(match.run.prefix).toBeGreaterThan(5);
  });

  test("a credential that ends like a registry script is flagged against it", () => {
    const ground = `${"0".repeat(48)}950bc3ac`;
    const match = matchAddress(OTHER, ground, buildBookIndex([]), registryIndex);
    expect(match?.kind).toBe("lookalike");
    if (match?.kind !== "lookalike") throw new Error("expected a lookalike");
    expect(match.field).toBe("cred");
    expect(match.target.origin).toBe("registry");
    expect(match.target.label).toBe("SundaeSwap");
    expect(match.target.detail).toBe("Liquidity Pool");
    expect(match.run.suffix).toBe(8);
  });

  test("an unrelated address gets nothing", () => {
    const book = buildBookIndex([entry()]);
    expect(matchAddress(OTHER, OTHER_CRED, book, registryIndex)).toBeNull();
  });

  test("the empty book and no registry answer nothing", () => {
    expect(matchAddress(MINE, MY_CRED, null, null)).toBeNull();
    expect(matchAddress(MINE, MY_CRED, buildBookIndex([]), null)).toBeNull();
  });
});

describe("buildBookIndex", () => {
  test("the first save of an address wins its slot", () => {
    const index = buildBookIndex([
      entry({ id: "a", label: "first" }),
      entry({ id: "b", label: "second" }),
    ]);
    expect(index.byAddress.get(MINE)?.label).toBe("first");
  });
});
