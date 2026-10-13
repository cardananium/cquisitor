import { describe, expect, test } from "bun:test";
import {
  addressLookalike,
  addressPrefixKey,
  addressSuffixKey,
  commonPrefixLength,
  commonSuffixLength,
  hexLookalike,
  hexPrefixKey,
  runScore,
} from "./similarity";

// The checks under test are string comparisons, so the strings here are shaped
// like addresses without being valid bech32. A valid pair would have to be
// ground, and the comparison never reads the checksum as a checksum.
const BASE = "addr1qy8ac7qqy0vtulyl7wntmsxc6wex80akj3nw3dmh3qpz0j9qxh2";
const SAME_HEAD = "addr1qy8ac7qqy0vtulyl7wntmsxc6wex80akj3nw3dmh3qpz0j9zzzz";
const SAME_TAIL = "addr1qzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzj9qxh2";
const UNRELATED = "addr1q9m4p2vkc7tt8hh2v3gq8r9zfdcgk5xhsdt0y7n6lsq4rfdmzqw";

describe("common runs", () => {
  test("a prefix and a suffix are counted from their own end", () => {
    expect(commonPrefixLength("abcdef", "abcxyz")).toBe(3);
    expect(commonSuffixLength("abcdef", "xyzdef")).toBe(3);
    expect(commonPrefixLength("", "abc")).toBe(0);
  });
});

describe("addressLookalike", () => {
  test("the same string is not a lookalike", () => {
    expect(addressLookalike(BASE, BASE)).toBeNull();
  });

  test("a shared head is reported with the prefix the caller can mark", () => {
    const run = addressLookalike(BASE, SAME_HEAD);
    expect(run).not.toBeNull();
    // "addr1" and the 47 data characters the two strings share.
    expect(run!.prefix).toBe(52);
    expect(run!.suffix).toBe(0);
    expect(BASE.slice(0, run!.prefix)).toBe(SAME_HEAD.slice(0, run!.prefix));
  });

  test("a shared tail is reported on its own", () => {
    const run = addressLookalike(BASE, SAME_TAIL);
    expect(run).not.toBeNull();
    expect(run!.suffix).toBeGreaterThanOrEqual(5);
    expect(BASE.slice(-run!.suffix)).toBe(SAME_TAIL.slice(-run!.suffix));
  });

  test("unrelated addresses are not reported", () => {
    expect(addressLookalike(BASE, UNRELATED)).toBeNull();
  });

  test("the header characters do not count, so one address type is not a match", () => {
    // Both are mainnet base addresses, so they agree on "addr1q" and nothing
    // after it. That is the common case, and it must stay quiet.
    const a = "addr1q2222222222222222222222222222222222222222222222222";
    const b = "addr1q3333333333333333333333333333333333333333333333333";
    expect(addressLookalike(a, b)).toBeNull();
  });

  test("different prefixes are never compared", () => {
    const mainnet = "addr1qy8ac7qqy0vtulyl7wntmsxc6wex80akj3nw3dmh3qpz0j9qxh2";
    const testnet = "addr_test1qy8ac7qqy0vtulyl7wntmsxc6wex80akj3nw3dmh3qpz0j9qxh2";
    expect(addressLookalike(mainnet, testnet)).toBeNull();
    expect(addressLookalike(mainnet, "stake1uy8ac7qqy0vtulyl7wntmsxc6wex80akj3nw3dmh3qpz0j9qxh2")).toBeNull();
  });

  test("the two runs never claim the same characters", () => {
    const run = addressLookalike("addr1aaaaaaaaaaaa", "addr1aaaaaaaaaaaaa");
    expect(run).not.toBeNull();
    expect(run!.prefix - "addr1".length + run!.suffix).toBeLessThanOrEqual(12);
  });
});

describe("hexLookalike", () => {
  const hash = "0029cb7c88c7567b63d1a512c0ed626aa169688ec980730c0473b913";

  test("eight leading characters are a match", () => {
    const ground = `0029cb7c${"f".repeat(48)}`;
    const run = hexLookalike(ground, hash);
    expect(run).not.toBeNull();
    expect(run!.prefix).toBe(8);
  });

  test("seven are not", () => {
    const ground = `0029cb7${"f".repeat(49)}`;
    expect(hexLookalike(ground, hash)).toBeNull();
  });

  test("eight trailing characters are a match", () => {
    const ground = `${"f".repeat(48)}0473b913`;
    const run = hexLookalike(ground, hash);
    expect(run).not.toBeNull();
    expect(run!.suffix).toBe(8);
  });

  test("the same hash is not a lookalike", () => {
    expect(hexLookalike(hash, hash)).toBeNull();
  });
});

describe("bucket keys", () => {
  test("two addresses that could be alike share the prefix key", () => {
    expect(addressPrefixKey(BASE)).toBe(addressPrefixKey(SAME_HEAD));
    expect(addressSuffixKey(BASE)).toBe(addressSuffixKey(SAME_TAIL));
  });

  test("a string too short to key gives null", () => {
    expect(addressPrefixKey("addr1q")).toBeNull();
    expect(addressSuffixKey("addr1")).toBeNull();
    expect(hexPrefixKey("00ff")).toBeNull();
  });
});

describe("runScore", () => {
  test("an address prefix counts from the first informative character", () => {
    // 52 shared characters: 5 of prefix, 2 of header, 45 that mean something.
    expect(runScore({ prefix: 52, suffix: 0 }, BASE, "address")).toBe(45);
    expect(runScore({ prefix: 8, suffix: 0 }, "00ff", "cred")).toBe(8);
  });
});
