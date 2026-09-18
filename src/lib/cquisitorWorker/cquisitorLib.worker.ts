// Worker that owns the page's wasm instance. One instance, one call at a time, so the schema cache is shared.
// Request handling is in `workerCore`; this file wires `self` and the module.

import { type LibLoadedMessage, type LibRequest, type LibResponse } from "./protocol";
import { answer, reply, type LibModule } from "./workerCore";

let libPromise: Promise<LibModule> | null = null;

function loadLib(): Promise<LibModule> {
  if (!libPromise) {
    libPromise = import("@cardananium/cquisitor-lib") as unknown as Promise<LibModule>;
  }
  return libPromise;
}

const scope = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: "message", handler: (event: { data: unknown }) => void): void;
};

const post = (message: LibResponse) => scope.postMessage(message);

scope.addEventListener("message", (event) => {
  const request = event.data as LibRequest;
  if (typeof request?.id !== "number") return;
  void answer(request, loadLib).then((response) => reply(response, post));
});

function announceLoaded(): void {
  scope.postMessage({ type: "loaded" } satisfies LibLoadedMessage);
}

// Announce as soon as load settles (ok or fail) so the page can start call budgets.
void loadLib().then(announceLoaded, announceLoaded);
