import { describe, expect, test } from "bun:test";
import { bech32 } from "bech32";
import { prepareViewData } from "./prepareViewData";

describe("prepareViewData", () => {
  test("bigints become strings, bytes become number arrays, other leaves stand", () => {
    expect(prepareViewData({ a: BigInt(10) ** BigInt(30), b: new Uint8Array([1, 2]), c: [null, true, "x", 3] }))
      .toEqual({ a: "1000000000000000000000000000000", b: [1, 2], c: [null, true, "x", 3] });
    expect(prepareViewData(BigInt(5))).toBe("5");
  });

  test("a bech32 vkey gains its hash; key order is kept", () => {
    const vkey = bech32.encode("ed25519_pk", bech32.toWords(new Uint8Array(32)));
    const out = prepareViewData({ vkey, other: 1 }) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(["vkey", "vkey_hash", "other"]);
    expect(out.vkey_hash).toMatch(/^[0-9a-f]{56}$/);
    const bad = prepareViewData({ vkey: "ed25519_pk_garbage" }) as Record<string, unknown>;
    expect(Object.keys(bad)).toEqual(["vkey"]);
  });

  test("a document a hundred thousand levels deep is copied without exhausting the stack", () => {
    let doc: unknown = BigInt(0);
    for (let i = 0; i < 100_000; i++) doc = { ScriptAll: { native_scripts: [doc] } };
    let copied = prepareViewData(doc);
    let levels = 0;
    while (typeof copied === "object" && copied !== null) {
      copied = (copied as { ScriptAll: { native_scripts: unknown[] } }).ScriptAll.native_scripts[0];
      levels++;
    }
    expect(levels).toBe(100_000);
    expect(copied).toBe("0");
  });
});
