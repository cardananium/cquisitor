import { describe, expect, test } from "bun:test";
import { brotliCompress, brotliDecompress } from "./compression";

describe("brotli round trip", () => {
  test("what went in comes back out", async () => {
    const payload = new TextEncoder().encode("Person = { name: tstr, age: uint }\n".repeat(50));
    const restored = await brotliDecompress(await brotliCompress(payload));
    expect(restored).toEqual(payload);
  });

  test("an empty payload survives", async () => {
    expect(await brotliDecompress(await brotliCompress(new Uint8Array()))).toEqual(new Uint8Array());
  });

  test("a payload larger than one output chunk survives", async () => {
    // The decoder is driven 64 KB at a time, so anything past that exercises
    // the loop rather than a single round.
    const payload = new Uint8Array(400_000);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) % 251;
    const restored = await brotliDecompress(await brotliCompress(payload));
    expect(restored).toEqual(payload);
  });
});

describe("the output bound", () => {
  test("a payload that expands past the cap is refused rather than allocated", async () => {
    // Brotli's ratio is unbounded: eight megabytes of zeroes compress to a
    // couple of hundred bytes, which fits in a link anyone can paste.
    const bomb = await brotliCompress(new Uint8Array(8 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(4096);
    await expect(brotliDecompress(bomb, 64 * 1024)).rejects.toThrow(/expands to more than/);
  });

  test("the refusal names the limit it applied", async () => {
    const bomb = await brotliCompress(new Uint8Array(1024 * 1024));
    await expect(brotliDecompress(bomb, 128 * 1024)).rejects.toThrow(/128 KB/);
  });

  test("a payload exactly at the cap is still allowed", async () => {
    const payload = new Uint8Array(1024);
    const restored = await brotliDecompress(await brotliCompress(payload), 1024);
    expect(restored.length).toBe(1024);
  });

  test("a truncated stream ends with a reason instead of looping", async () => {
    const compressed = await brotliCompress(new TextEncoder().encode("x".repeat(10_000)));
    await expect(brotliDecompress(compressed.subarray(0, 4))).rejects.toThrow(/incomplete/);
  });
});
