import type { BrotliWasmType } from "brotli-wasm";
import { MAX_SHARE_PAYLOAD_BYTES, formatByteSize } from "@/utils/inputBudget";

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

/** How much output is asked for per round of the streaming decoder. */
const OUTPUT_CHUNK_BYTES = 64 * 1024;

/**
 * Decompress `input`, stopping if output would exceed `maxOutputBytes`.
 * Brotli ratio is unbounded, so URL length is not a size bound.
 */
export async function brotliDecompress(
  input: Uint8Array,
  maxOutputBytes: number = MAX_SHARE_PAYLOAD_BYTES,
): Promise<Uint8Array> {
  const brotli = await getBrotli();
  const stream = new brotli.DecompressStream();
  try {
    const chunks: Uint8Array[] = [];
    let produced = 0;
    let consumed = 0;

    for (;;) {
      const result = stream.decompress(input.subarray(consumed), OUTPUT_CHUNK_BYTES);
      const chunk = result.buf;
      const code = result.code;
      const advanced = result.input_offset;
      result.free();

      if (chunk.length > 0) {
        chunks.push(chunk);
        produced += chunk.length;
        if (produced > maxOutputBytes) {
          throw new Error(
            `This link expands to more than ${formatByteSize(maxOutputBytes)}, ` +
              `which is more than a shared document is expected to hold.`,
          );
        }
      }
      consumed += advanced;

      if (code === brotli.BrotliStreamResultCode.ResultSuccess) break;
      if (advanced === 0 && chunk.length === 0) {
        // Decoder made no progress: truncated brotli stream.
        throw new Error("This link's payload is incomplete.");
      }
    }

    const out = new Uint8Array(produced);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  } finally {
    stream.free();
  }
}
