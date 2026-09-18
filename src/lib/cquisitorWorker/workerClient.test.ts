import { describe, expect, test } from "bun:test";
import {
  HARD_TIMEOUT_MS,
  WorkerTransport,
  abandonedMessage,
  hardTimeoutFor,
  neverRanMessage,
  stillLoadingMessage,
  type WorkerLike,
} from "./workerClient";
import {
  LibAbortedError,
  LibInputTooLargeError,
  LibResultNotTransferableError,
  LibTimeoutError,
  LibUnavailableError,
  isLibRefusal,
  type LibTransport,
} from "./transport";
import type { LibRequest, LibResponse } from "./protocol";
import { MAX_LIB_INPUT_BYTES } from "@/utils/inputBudget";

/** Fake worker that records posts and answers on demand. */
class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly posted: LibRequest[] = [];
  terminated = false;

  /** `announce: false` skips the loaded message, as if wasm is still downloading. */
  constructor(announce = true) {
    if (announce) queueMicrotask(() => this.loaded());
  }

  loaded(): void {
    if (!this.terminated) this.onmessage?.({ data: { type: "loaded" } });
  }

  postMessage(message: unknown): void {
    this.posted.push(message as LibRequest);
  }

  terminate(): void {
    this.terminated = true;
  }

  answer(value: unknown, index = this.posted.length - 1): void {
    const request = this.posted[index];
    this.deliver({ id: request.id, gen: request.gen, ok: true, value });
  }

  fail(message: string, fatal: boolean, index = this.posted.length - 1): void {
    const request = this.posted[index];
    this.deliver({
      id: request.id,
      gen: request.gen,
      ok: false,
      error: { name: fatal ? "RuntimeError" : "Error", message, fatal },
    });
  }

  /** Reply as a document walker: JSON text, not a cloned object. */
  answerText(json: string, index = this.posted.length - 1): void {
    const request = this.posted[index];
    this.deliver({ id: request.id, gen: request.gen, ok: true, json });
  }

  deliver(response: LibResponse): void {
    this.onmessage?.({ data: response });
  }
}

/** WorkerTransport over a new FakeWorker per spawn. */
function fakeTransport(options?: {
  softTimeoutMs?: number;
  hardTimeoutMs?: number;
  moduleLoadTimeoutMs?: number;
  announce?: boolean;
  fallback?: LibTransport;
}) {
  const workers: FakeWorker[] = [];
  const transport = new WorkerTransport({
    spawn: () => {
      const worker = new FakeWorker(options?.announce ?? true);
      workers.push(worker);
      return worker;
    },
    softTimeoutMs: options?.softTimeoutMs ?? 60_000,
    hardTimeoutMs: options?.hardTimeoutMs ?? 60_000,
    moduleLoadTimeoutMs: options?.moduleLoadTimeoutMs ?? 60_000,
    fallback: options?.fallback ? () => options.fallback! : undefined,
  });
  return { transport, workers, latest: () => workers[workers.length - 1] };
}

/** Lets every already-queued microtask and timer callback run. */
const settle = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

describe("one call at a time", () => {
  test("a second call waits until the first has answered", async () => {
    const { transport, latest } = fakeTransport();
    const first = transport.call("cddl_outline", ["a = int\n"]);
    const second = transport.call("cddl_outline", ["b = int\n"]);
    await settle();

    expect(latest().posted.length).toBe(1);
    latest().answer("first");
    expect(await first).toBe("first");

    await settle();
    expect(latest().posted.length).toBe(2);
    latest().answer("second");
    expect(await second).toBe("second");
    expect(latest().posted.map(r => r.args[0])).toEqual(["a = int\n", "b = int\n"]);
  });

  test("the worker is spawned on the first call, not before", async () => {
    const { transport, workers } = fakeTransport();
    expect(workers.length).toBe(0);
    const call = transport.call("cddl_outline", ["a = int\n"]);
    await settle();
    expect(workers.length).toBe(1);
    workers[0].answer([]);
    await call;
  });

  test("an error the library reported is thrown, and the worker is kept", async () => {
    const { transport, workers, latest } = fakeTransport();
    const call = transport.call("cddl_format", ["Person = {"]);
    await settle();
    latest().fail("cddl parse error", false);
    await expect(call).rejects.toThrow("cddl parse error");
    expect(workers[0].terminated).toBe(false);
  });
});

describe("a trap takes down the worker, not the page", () => {
  test("the instance that trapped is discarded and the next call gets a fresh one", async () => {
    const { transport, workers, latest } = fakeTransport();
    const doomed = transport.call("cbor_to_json", ["deadbeef"]);
    await settle();
    latest().fail("unreachable", true);
    await expect(doomed).rejects.toThrow("unreachable");
    expect(workers[0].terminated).toBe(true);

    const next = transport.call("cbor_to_json", ["01"]);
    await settle();
    expect(workers.length).toBe(2);
    workers[1].answer("fresh");
    expect(await next).toBe("fresh");
  });

  test("a reply from the discarded worker is ignored", async () => {
    const { transport, workers, latest } = fakeTransport();
    const doomed = transport.call("cbor_to_json", ["deadbeef"]);
    await settle();
    const dead = latest();
    dead.fail("unreachable", true);
    await expect(doomed).rejects.toThrow("unreachable");

    const next = transport.call("cbor_to_json", ["01"]);
    await settle();
    // Stale reply uses the new id but the old generation.
    dead.deliver({ id: workers[1].posted[0].id, gen: 0, ok: true, value: "stale" });
    await settle();
    workers[1].answer("fresh");
    expect(await next).toBe("fresh");
  });
});

describe("an answer in JSON text", () => {
  test("is parsed on the page, with its numbers converted by the library's rule", async () => {
    const { transport, latest } = fakeTransport();
    const call = transport.call("cbor_to_json", ["1bffffffffffffffff"]);
    await settle();
    latest().answerText(
      '{"ok":true,"value":{"type":"U64","value":{"$serde_json::private::Number":"18446744073709551615"}}}',
    );
    expect(await call).toEqual({
      ok: true,
      value: { type: "U64", value: BigInt("18446744073709551615") },
    });
  });

  test("nested ten thousand levels deep crosses whole and is read without a frame per level", async () => {
    const { transport, latest } = fakeTransport();
    const depth = 10_000;
    const call = transport.call("cbor_to_json", ["81".repeat(depth) + "05"]);
    await settle();
    latest().answerText("[".repeat(depth) + "5" + "]".repeat(depth));
    let cursor: unknown = await call;
    for (let i = 0; i < depth; i++) cursor = (cursor as unknown[])[0];
    expect(cursor).toBe(5);
  });

  test("text that is not JSON is reported as the answer being unreadable, and the worker is kept", async () => {
    const { transport, workers, latest } = fakeTransport();
    const call = transport.call("cbor_to_json", ["01"]);
    await settle();
    latest().answerText("{not json");
    await expect(call).rejects.toThrow("could not be read");
    expect(workers[0].terminated).toBe(false);
  });
});

describe("an answer the worker could not hand over", () => {
  test("is a refusal of its own kind, not the library's opinion of the input", async () => {
    const { transport, workers, latest } = fakeTransport();
    const call = transport.call("decode_specific_type", ["00", "Address"]);
    await settle();
    const request = latest().posted[0];
    latest().deliver({
      id: request.id,
      gen: request.gen,
      ok: false,
      error: {
        name: "DataCloneError",
        message: "The library answered, but the answer could not be handed to the page: too deep",
        fatal: false,
        kind: "result_not_transferable",
      },
    });
    const error: unknown = await call.catch(e => e);
    expect(error).toBeInstanceOf(LibResultNotTransferableError);
    expect(isLibRefusal(error)).toBe(true);
    expect((error as Error).message).toContain("could not be handed to the page");
    // Clone failure is not fatal to the instance.
    expect(workers[0].terminated).toBe(false);
  });
});

describe("the watchdog", () => {
  test("abandons a pass that will not return, and recovers", async () => {
    const { transport, workers, latest } = fakeTransport({ hardTimeoutMs: 10 });
    const stuck = transport.call("map_cbor_to_cddl", ["01", "a = int\n", "a"]);
    await settle();
    const first = latest();
    await expect(stuck).rejects.toBeInstanceOf(LibTimeoutError);
    expect(first.terminated).toBe(true);

    const next = transport.call("cddl_outline", ["a = int\n"]);
    await settle();
    expect(workers.length).toBe(2);
    workers[1].answer([]);
    expect(await next).toEqual([]);
  });

  test("says how long it waited, so a panel can explain itself", async () => {
    const { transport } = fakeTransport({ hardTimeoutMs: 10 });
    const stuck = transport.call("map_cbor_to_cddl", ["01", "a = int\n", "a"]);
    await expect(stuck).rejects.toThrow(/did not answer/);
  });

  test("the rest of the abandoned caller's pass goes with it", async () => {
    const { transport } = fakeTransport({ hardTimeoutMs: 10 });
    const pass = new AbortController();
    // Attach both handlers first; they reject in the same turn.
    const stuck = transport
      .call("map_cbor_to_cddl", ["01", "a = int\n", "a"], { signal: pass.signal })
      .catch(e => e);
    const sibling = transport
      .call("decode_cbor_against_cddl", ["01", "a = int\n", "a"], { signal: pass.signal })
      .catch(e => e);
    expect(await stuck).toBeInstanceOf(LibTimeoutError);
    expect(await sibling).toBeInstanceOf(LibTimeoutError);
  });

  test("another caller's queued call keeps its place and runs", async () => {
    const { transport, workers } = fakeTransport({ hardTimeoutMs: 10 });
    const wedged = new AbortController();
    const stuck = transport
      .call("map_cbor_to_cddl", ["01", "a = int\n", "a"], { signal: wedged.signal })
      .catch(e => e);
    const elsewhere = transport.call("cbor_to_json", ["01"]);

    expect(await stuck).toBeInstanceOf(LibTimeoutError);
    await settle();
    expect(workers.length).toBe(2);
    workers[1].answer("decoded");
    expect(await elsewhere).toBe("decoded");
  });

  test("a call whose cost is script evaluation gets a budget of its own", () => {
    // validate_transaction_js is priced in Plutus units, not document bytes.
    expect(hardTimeoutFor("validate_transaction_js")).toBeGreaterThan(HARD_TIMEOUT_MS);
    expect(hardTimeoutFor("cbor_to_json")).toBe(HARD_TIMEOUT_MS);
    // Multiples of the base, so tests can shorten every budget together.
    expect(hardTimeoutFor("validate_transaction_js", 10)).toBe(
      10 * (hardTimeoutFor("validate_transaction_js") / HARD_TIMEOUT_MS),
    );
  });

  test("the longer budget is the one the watchdog actually applies", async () => {
    const { transport, workers } = fakeTransport({ hardTimeoutMs: 20 });
    const call = transport.call("validate_transaction_js", ["00", "{}"]).catch(e => e);
    // Past the 20ms base, still under this call's 6× budget.
    await settle(60);
    expect(workers[0].terminated).toBe(false);
    workers[0].answer("{}");
    expect(await call).toBe("{}");
  });

  test("the reason it gives names no schema, since any tab can be the one cut off", async () => {
    const { transport } = fakeTransport({ hardTimeoutMs: 10 });
    const error = await transport
      .call("validate_transaction_js", ["00", "{}"])
      .then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(LibTimeoutError);
    expect((error as Error).message).not.toMatch(/schema|rule/i);
  });

  test("a pass that answers in time is never killed", async () => {
    const { transport, workers, latest } = fakeTransport({ hardTimeoutMs: 40 });
    const call = transport.call("cddl_outline", ["a = int\n"]);
    await settle();
    latest().answer(["ok"]);
    expect(await call).toEqual(["ok"]);
    await settle(60);
    expect(workers[0].terminated).toBe(false);
  });

  test("a slow pass says so before it is given up on", async () => {
    const { transport, latest } = fakeTransport({ softTimeoutMs: 5, hardTimeoutMs: 60_000 });
    let slow = false;
    const call = transport.call("cddl_outline", ["a = int\n"], { onSlow: () => { slow = true; } });
    await settle();
    expect(slow).toBe(false);
    await settle(20);
    expect(slow).toBe(true);
    latest().answer([]);
    await call;
  });

  test("a pass that finishes first never reports itself as slow", async () => {
    const { transport, latest } = fakeTransport({ softTimeoutMs: 20, hardTimeoutMs: 60_000 });
    let slow = false;
    const call = transport.call("cddl_outline", ["a = int\n"], { onSlow: () => { slow = true; } });
    await settle();
    latest().answer([]);
    await call;
    await settle(40);
    expect(slow).toBe(false);
  });
});

describe("waiting for a turn is part of the wait", () => {
  test("a call queued behind a longer budget is not left waiting past its own", async () => {
    const { transport, workers } = fakeTransport({ hardTimeoutMs: 20 });
    const head = transport.call("validate_transaction_js", ["00", "{}"]).catch(e => e);
    const queued = transport.call("cbor_to_json", ["01"]).catch(e => e);

    const error = await queued;
    expect(error).toBeInstanceOf(LibTimeoutError);
    // Expired in queue: message must not blame the unread input.
    expect((error as Error).message).toMatch(/never ran/);
    expect((error as Error).message).not.toMatch(/too large|too complex/);
    // Queued timeout must not kill the worker that is busy with another call.
    expect(workers.length).toBe(1);
    expect(workers[0].terminated).toBe(false);
    workers[0].answer("{}");
    expect(await head).toBe("{}");
  });

  test("a call that finally gets its turn is given a full budget to run in", async () => {
    // Same tick: a budget that never reset at dispatch would expire `behind` immediately.
    const { transport, workers } = fakeTransport({ hardTimeoutMs: 25 });
    const wedged = transport.call("cbor_to_json", ["ff"]).catch(e => e);
    const behind = transport.call("cddl_outline", ["a = int\n"]).catch(e => e);

    expect(await wedged).toBeInstanceOf(LibTimeoutError);
    await settle(15);
    expect(workers.length).toBe(2);
    workers[1].answer(["ok"]);
    expect(await behind).toEqual(["ok"]);
  });

  test("a call still waiting its turn says it is still working", async () => {
    const { transport, latest } = fakeTransport({ softTimeoutMs: 5, hardTimeoutMs: 60_000 });
    const head = transport.call("cddl_outline", ["a = int\n"]);
    let slow = false;
    const queued = transport.call("cddl_outline", ["b = int\n"], {
      onSlow: () => { slow = true; },
    });
    await settle(20);
    expect(latest().posted.length).toBe(1);
    expect(slow).toBe(true);

    latest().answer(["a"]);
    expect(await head).toEqual(["a"]);
    await settle();
    latest().answer(["b"]);
    expect(await queued).toEqual(["b"]);
  });

  test("the reason names the wait as well as the run", () => {
    expect(abandonedMessage(10_000, 0)).not.toMatch(/waited/);
    const queued = abandonedMessage(10_000, 9_000);
    expect(queued).toMatch(/did not answer within 10 s/);
    expect(queued).toMatch(/already waited 9 s for its turn/);
    // Sub-second queue wait is omitted from the message.
    expect(abandonedMessage(10_000, 40)).toBe(abandonedMessage(10_000, 0));
    expect(neverRanMessage(10_000)).toMatch(/10 s/);
  });
});

describe("the module the worker has to load first", () => {
  /** Fake in-process fallback; tests must not load the real one. */
  function inProcess() {
    const calls: string[] = [];
    const transport: LibTransport = {
      async call<T>(fn: string): Promise<T> {
        calls.push(fn);
        return "in process" as T;
      },
    } as LibTransport;
    return { calls, transport };
  }

  test("a call is not held to its budget while the wasm is still arriving", async () => {
    const { transport, workers, latest } = fakeTransport({
      hardTimeoutMs: 10,
      moduleLoadTimeoutMs: 10_000,
      announce: false,
    });
    const call = transport.call("cbor_to_json", ["01"]).catch(e => e);
    await settle(60);
    expect(workers.length).toBe(1);
    expect(workers[0].terminated).toBe(false);
    expect(workers[0].posted.length).toBe(1);

    // After load, the call budget applies.
    latest().loaded();
    expect(await call).toBeInstanceOf(LibTimeoutError);
    expect(workers[0].terminated).toBe(true);
  });

  test("a call queued behind the load is not charged for it either", async () => {
    const { transport, latest } = fakeTransport({
      hardTimeoutMs: 30,
      moduleLoadTimeoutMs: 10_000,
      announce: false,
    });
    const head = transport.call("cddl_outline", ["a = int\n"]);
    const queued = transport.call("cddl_outline", ["b = int\n"]);
    await settle(60);

    latest().loaded();
    await settle();
    latest().answer(["a"], 0);
    expect(await head).toEqual(["a"]);
    await settle();
    latest().answer(["b"], 1);
    expect(await queued).toEqual(["b"]);
  });

  test("a module that never arrives costs the page its worker, not the pass", async () => {
    const fallback = inProcess();
    const { transport, workers } = fakeTransport({
      hardTimeoutMs: 10_000,
      moduleLoadTimeoutMs: 20,
      announce: false,
      fallback: fallback.transport,
    });
    expect(await transport.call<string>("cbor_to_json", ["01"])).toBe("in process");
    expect(workers[0].terminated).toBe(true);

    // Load timeout is spent once; do not spawn a second worker.
    expect(await transport.call<string>("cbor_to_json", ["02"])).toBe("in process");
    expect(workers.length).toBe(1);
    expect(fallback.calls.length).toBe(2);
  });

  test("a worker is tried again once the run of failures is behind it", async () => {
    const workers: FakeWorker[] = [];
    const fallback = inProcess();
    const transport = new WorkerTransport({
      spawn: () => {
        // First spawn still downloading; later spawns announce immediately.
        const worker = new FakeWorker(workers.length > 0);
        workers.push(worker);
        return worker;
      },
      moduleLoadTimeoutMs: 20,
      failureDecayMs: 30,
      fallback: () => fallback.transport,
    });
    expect(await transport.call<string>("cbor_to_json", ["01"])).toBe("in process");
    await settle(60);
    const call = transport.call("cbor_to_json", ["02"]);
    await settle();
    expect(workers.length).toBe(2);
    workers[1].answer("from a worker");
    expect(await call).toBe("from a worker");
  });

  test("with nowhere else to run, the reason names the load and not the input", async () => {
    const { transport } = fakeTransport({ moduleLoadTimeoutMs: 20, announce: false });
    const error = await transport.call("cbor_to_json", ["01"]).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(LibUnavailableError);
    expect(isLibRefusal(error)).toBe(true);
    expect((error as Error).message).toMatch(/still loading/);
    expect((error as Error).message).not.toMatch(/too large|too complex/);
  });

  test("the sentence for a module that never came says whose fault it is not", () => {
    const message = stillLoadingMessage(60_000);
    expect(message).toMatch(/60 s/);
    expect(message).not.toMatch(/too large|too complex/);
  });

  test("an answer counts as the module being in place, announcement or not", async () => {
    const { transport, workers, latest } = fakeTransport({
      hardTimeoutMs: 40,
      moduleLoadTimeoutMs: 10_000,
      announce: false,
    });
    const first = transport.call("cddl_outline", ["a = int\n"]);
    await settle();
    latest().answer(["a"]);
    expect(await first).toEqual(["a"]);

    // After an answer, the next call uses its own budget, not the load budget.
    const stuck = transport.call("cbor_to_json", ["01"]).catch(e => e);
    expect(await stuck).toBeInstanceOf(LibTimeoutError);
    expect(workers[0].terminated).toBe(true);
  });

  test("a pass abandoned for its own cost does not push the next one onto the page", async () => {
    // Watchdog kills must not count as worker failures (that would fall back in-process).
    const fallback = inProcess();
    const { transport, workers } = fakeTransport({
      hardTimeoutMs: 10,
      fallback: fallback.transport,
    });
    for (let i = 0; i < 4; i++) {
      const error = await transport.call("cbor_to_json", ["01"]).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(LibTimeoutError);
      await settle();
    }
    expect(fallback.calls.length).toBe(0);
    expect(workers.length).toBe(4);
  });
});

describe("a worker that will not take the message", () => {
  /** Transport whose worker throws from postMessage. */
  function refusingTransport(fallback?: LibTransport) {
    const workers: FakeWorker[] = [];
    const transport = new WorkerTransport({
      spawn: () => {
        const worker = new FakeWorker();
        worker.postMessage = () => {
          throw new Error("cddl_outline could not be cloned");
        };
        workers.push(worker);
        return worker;
      },
      fallback: fallback ? () => fallback : undefined,
    });
    return { transport, workers };
  }

  test("the refusal is reported as the worker failing, not as the library's answer", async () => {
    const { transport, workers } = refusingTransport();
    const error = await transport.call("cbor_to_json", ["01"]).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(LibUnavailableError);
    expect(isLibRefusal(error)).toBe(true);
    expect((error as Error).message).not.toMatch(/cloned/);
    expect(workers[0].terminated).toBe(true);
  });

  test("it counts against the same budget every other worker failure does", async () => {
    const inProcess: LibTransport = {
      async call<T>(): Promise<T> {
        return "in process" as T;
      },
    };
    const { transport, workers } = refusingTransport(inProcess);
    const results: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(await transport.call("cbor_to_json", ["01"]).then(v => v, (e: unknown) => e));
    }
    expect(results.slice(0, 3).every(r => r instanceof LibUnavailableError)).toBe(true);
    // After three failures, further calls go in-process.
    expect(results.slice(3)).toEqual(["in process", "in process"]);
    expect(workers.length).toBe(3);
  });
});

describe("superseded calls", () => {
  test("a queued call the caller dropped never reaches the worker", async () => {
    const { transport, latest } = fakeTransport();
    const holding = transport.call("cddl_outline", ["a = int\n"]);
    await settle();

    const controller = new AbortController();
    const dropped = transport.call("cddl_outline", ["b = int\n"], { signal: controller.signal });
    controller.abort();
    await expect(dropped).rejects.toBeInstanceOf(LibAbortedError);

    latest().answer(["a"]);
    expect(await holding).toEqual(["a"]);
    await settle();
    expect(latest().posted.length).toBe(1);
  });

  test("a call already inside wasm is not cancelled, only ignored", async () => {
    // Abort after dispatch cannot interrupt wasm; do not kill the worker.
    const { transport, workers, latest } = fakeTransport();
    const controller = new AbortController();
    const call = transport.call("cddl_outline", ["a = int\n"], { signal: controller.signal });
    await settle();
    controller.abort();
    latest().answer(["a"]);
    expect(await call).toEqual(["a"]);
    expect(workers[0].terminated).toBe(false);
  });

  test("a call aborted before it was made never spawns anything", async () => {
    const { transport, workers } = fakeTransport();
    const controller = new AbortController();
    controller.abort();
    const call = transport.call("cddl_outline", ["a = int\n"], { signal: controller.signal });
    await expect(call).rejects.toBeInstanceOf(LibAbortedError);
    expect(workers.length).toBe(0);
  });
});

describe("input the decoder is not trusted with", () => {
  test("an oversized document is refused before a worker is even started", async () => {
    const { transport, workers } = fakeTransport();
    const huge = "a".repeat(MAX_LIB_INPUT_BYTES + 1);
    const call = transport.call("cbor_to_json", [huge]);
    await expect(call).rejects.toBeInstanceOf(LibInputTooLargeError);
    expect(workers.length).toBe(0);
  });

  test("the refusal names the size and the limit", async () => {
    const { transport } = fakeTransport();
    const huge = "a".repeat(4 * 1024 * 1024);
    await expect(transport.call("cbor_to_json", [huge])).rejects.toThrow(/4\.0 MB.*2\.0 MB/);
  });

  test("a document just under the limit is allowed through", async () => {
    const { transport, latest } = fakeTransport();
    const call = transport.call("cbor_to_json", ["a".repeat(MAX_LIB_INPUT_BYTES)]);
    await settle();
    latest().answer("ok");
    expect(await call).toBe("ok");
  });

  test("a function name that is not on the allowlist never reaches the worker", async () => {
    const { transport, workers } = fakeTransport();
    // Allowlist: a wasm export name must not be callable just because it exists.
    const call = transport.call("free" as never, []);
    await expect(call).rejects.toThrow(/not a callable library function/);
    expect(workers.length).toBe(0);
  });
});

describe("a worker that dies on its own", () => {
  test("the pass it was running is reported, and the next one gets a new worker", async () => {
    const { transport, workers, latest } = fakeTransport();
    const call = transport.call("cbor_to_json", ["01"]);
    await settle();
    latest().onerror?.({ message: "worker crashed" });
    await expect(call).rejects.toThrow(/stopped unexpectedly/);

    const next = transport.call("cbor_to_json", ["01"]);
    await settle();
    expect(workers.length).toBe(2);
    workers[1].answer("fresh");
    expect(await next).toBe("fresh");
  });

  test("a worker that cannot be started at all is reported rather than retried forever", async () => {
    let spawns = 0;
    const transport = new WorkerTransport({
      spawn: () => {
        spawns++;
        throw new Error("no worker support here");
      },
    });
    for (let i = 0; i < 5; i++) {
      await expect(transport.call("cbor_to_json", ["01"])).rejects.toThrow(/could not be started/);
    }
    expect(spawns).toBeLessThanOrEqual(3);
  });
});

describe("no worker to be had", () => {
  /** Fake in-process fallback; tests must not load the real one. */
  function countingFallback() {
    const calls: string[] = [];
    const transport: LibTransport = {
      async call<T>(fn: string): Promise<T> {
        calls.push(fn);
        return "in process" as T;
      },
    } as LibTransport;
    return { calls, transport };
  }

  test("a worker script that will not load costs the page a watchdog, not the library", async () => {
    const fallback = countingFallback();
    const transport = new WorkerTransport({
      spawn: () => {
        throw new Error("404");
      },
      fallback: () => fallback.transport,
    });
    for (let i = 0; i < 5; i++) {
      expect(await transport.call<string>("cbor_to_json", ["01"])).toBe("in process");
    }
    expect(fallback.calls.length).toBe(5);
  });

  test("the fallback is built once, however many calls need it", async () => {
    let built = 0;
    const fallback = countingFallback();
    const transport = new WorkerTransport({
      spawn: () => {
        throw new Error("404");
      },
      fallback: () => {
        built++;
        return fallback.transport;
      },
    });
    await transport.call("cbor_to_json", ["01"]);
    await transport.call("cbor_to_json", ["02"]);
    expect(built).toBe(1);
  });

  test("a worker that dies once does not cost the session its watchdog", async () => {
    const workers: FakeWorker[] = [];
    const fallback = countingFallback();
    const transport = new WorkerTransport({
      spawn: () => {
        if (workers.length < 3) {
          workers.push(new FakeWorker());
          throw new Error("crashed on start");
        }
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      failureDecayMs: 10,
      fallback: () => fallback.transport,
    });

    for (let i = 0; i < 3; i++) {
      expect(await transport.call<string>("cbor_to_json", ["01"])).toBe("in process");
    }
    // Fourth call uses fallback without spawning.
    expect(await transport.call<string>("cbor_to_json", ["01"])).toBe("in process");
    expect(workers.length).toBe(3);

    await settle(20);
    const call = transport.call("cbor_to_json", ["01"]);
    await settle();
    expect(workers.length).toBe(4);
    workers[3].answer("from a worker");
    expect(await call).toBe("from a worker");
  });

  test("without a fallback the call still says why it could not run", async () => {
    const transport = new WorkerTransport({
      spawn: () => {
        throw new Error("404");
      },
    });
    await expect(transport.call("cbor_to_json", ["01"])).rejects.toBeInstanceOf(
      LibUnavailableError,
    );
  });
});
