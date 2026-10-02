// The app's one-time wiring of @cardananium/cquisitor-lib. Two services are
// the page's to provide: where the wasm runs (a worker, so a trap or a runaway
// pass kills a replaceable worker and not the page; on the page's own thread
// when no worker can be started or its wasm will not load) and brotli for `e=b`
// share links (brotli-wasm). `Providers` evaluates this before any effect can
// call the library; tests call it for the compressor and keep the in-process
// default.

import { configure } from "@cardananium/cquisitor-lib";
import { brotliCompress, brotliDecompress } from "@/utils/shareLink/compression";
import { createLibWorkerBackend } from "./cquisitorWorker";

let installed = false;

/** True where a page can hand the wasm to a Web Worker. Node and bun tests run it in process. */
function canRunInWorker(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

/** Register the app's backend and compressor. Idempotent. */
export function installCquisitorLib(): void {
  if (installed) return;
  installed = true;
  configure({
    compressor: { compress: brotliCompress, decompress: brotliDecompress },
    ...(canRunInWorker() ? { backend: createLibWorkerBackend() } : {}),
  });
}
