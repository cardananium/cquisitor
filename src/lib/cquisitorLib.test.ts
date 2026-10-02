import { describe, expect, test } from "bun:test";
import { getCompressor, isCompressorConfigured } from "@cardananium/cquisitor-lib";
import { installCquisitorLib } from "./cquisitorLib";

describe("installCquisitorLib", () => {
  test("registers the app's brotli compressor, once", async () => {
    installCquisitorLib();
    installCquisitorLib();
    expect(isCompressorConfigured()).toBe(true);
    const compressor = getCompressor();
    const payload = new TextEncoder().encode("Person = { name: tstr }\n".repeat(20));
    const packed = await compressor.compress(payload);
    expect(packed.length).toBeLessThan(payload.length);
    expect(await compressor.decompress(packed, 1 << 20)).toEqual(payload);
  });

  test("the compressor refuses output past the bound it is given", async () => {
    installCquisitorLib();
    const payload = new Uint8Array(200_000);
    const packed = await getCompressor().compress(payload);
    await expect(getCompressor().decompress(packed, 1024)).rejects.toThrow("expands to more than");
  });
});
