import type { BrotliWasmType } from "brotli-wasm";

let brotliPromise: Promise<BrotliWasmType> | null = null;

async function getBrotli(): Promise<BrotliWasmType> {
  if (!brotliPromise) {
    brotliPromise = import("brotli-wasm").then((m) => m.default);
  }
  return brotliPromise;
}

export async function brotliCompress(input: Uint8Array): Promise<Uint8Array> {
  const brotli = await getBrotli();
  return brotli.compress(input, { quality: 11 });
}

export async function brotliDecompress(input: Uint8Array): Promise<Uint8Array> {
  const brotli = await getBrotli();
  return brotli.decompress(input);
}
