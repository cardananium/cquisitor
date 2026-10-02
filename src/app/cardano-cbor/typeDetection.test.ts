// Type detection through the real library, in process.

import { describe, expect, test } from "bun:test";
import { configure, getBackend, type LibBackend } from "@cardananium/cquisitor-lib";
import { detectTypesWithFallback } from "./typeDetection";

/** A Conway transaction whose witness set carries a native script `levels` ScriptAll levels deep. */
function deepNativeScriptTx(levels: number): string {
  const script = "820181".repeat(levels - 1) + "8200581c" + "11".repeat(28);
  const addr = "5839" + "01" + "22".repeat(28) + "33".repeat(28);
  const body = "a3" + "00" + "81" + "825820" + "44".repeat(32) + "00" + "01" + "81" + "82" + addr + "1a001e8480" + "02" + "1a00030d40";
  return "84" + body + "a1" + "01" + "81" + script + "f5" + "f6";
}

const NATIVE_SCRIPT_HEX = "8200581c" + "11".repeat(28);

/** A transaction whose witness set carries Plutus data nested `levels` arrays deep (no native script). */
function deepPlutusDataTx(levels: number): string {
  const body = "a3" + "00" + "81" + "825820" + "44".repeat(32) + "00" + "01" + "80" + "02" + "1a00030d40";
  return "84" + body + "a1" + "04" + "81" + "81".repeat(levels) + "00" + "f5" + "f6";
}

describe("detectTypesWithFallback", () => {
  test("a transaction with a deep native script decodes as Transaction, noting the types not tried", async () => {
    const r = await detectTypesWithFallback(deepNativeScriptTx(10_000));
    expect(r.types).toEqual(["Transaction"]);
    expect(r.unexamined).toBeNull();
    expect(r.skipped).toContain("not tried");
    expect(r.skipped).toContain("20,002 levels deep");
    expect(r.skipped).toContain("64-level limit");
    expect(r.skipped).toContain("native scripts do not count");
    expect(r.skipped).toContain("TransactionBody");
    expect(r.skipped).toContain("implementation limit");
    expect(r.notification).toBeNull();
  });

  test("a transaction nested past the typed decoders outside native scripts is not examined, not 'no type'", async () => {
    const r = await detectTypesWithFallback(deepPlutusDataTx(100));
    expect(r.types).toEqual([]);
    expect(r.skipped).toBeNull();
    expect(r.unexamined).toContain("Not examined");
    expect(r.unexamined).toContain("64-level limit");
    expect(r.unexamined).toContain("native scripts do not count");
    expect(r.unexamined).toContain("implementation limit");
    expect(r.notification).toBeNull();
  });

  test("a native script past the walkers' bound is not examined, naming 32,768", async () => {
    const r = await detectTypesWithFallback("820181".repeat(17_000) + NATIVE_SCRIPT_HEX);
    expect(r.types).toEqual([]);
    expect(r.unexamined).toContain("Not examined");
    expect(r.unexamined).toContain("32,768-level limit");
  });

  test("a shallow native script is detected", async () => {
    const r = await detectTypesWithFallback(NATIVE_SCRIPT_HEX);
    expect(r.types).toContain("NativeScript");
    expect(r.unexamined).toBeNull();
    expect(r.skipped).toBeNull();
  });

  test("valid hex with no type is not retried as base64", async () => {
    // "deadbeef" is valid hex and valid base64 alike.
    const r = await detectTypesWithFallback("deadbeef");
    expect(r.types).toEqual([]);
    expect(r.notification).toBeNull();
    expect(r.processedInput).toBe("deadbeef");
  });

  test("base64 that is not hex is read as base64", async () => {
    const b64 = Buffer.from(NATIVE_SCRIPT_HEX, "hex").toString("base64");
    const r = await detectTypesWithFallback(b64);
    expect(r.types).toContain("NativeScript");
    expect(r.notification).toBe("Base64 → hex");
    expect(r.processedInput).toBe(NATIVE_SCRIPT_HEX);
  });

  test("a library failure propagates instead of reading as 'no Cardano type'", async () => {
    const real = getBackend();
    const failing: LibBackend = {
      callRaw() {
        return Promise.reject(new Error("worker died"));
      },
    };
    configure({ backend: failing });
    try {
      await expect(detectTypesWithFallback(NATIVE_SCRIPT_HEX)).rejects.toThrow("worker died");
    } finally {
      configure({ backend: real });
    }
  });
});
