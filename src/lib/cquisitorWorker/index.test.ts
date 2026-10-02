// The app's part of the worker backend: its budgets reach the library's
// watchdog, the "still working" notice fires on the app's clock, and a page
// that cannot have a worker runs the library on its own thread instead. The
// queue, respawn and load handshake are the library's and are tested there.
import { describe, expect, test } from "bun:test";
import {
  isLibRequest,
  LibTimeoutError,
  LibUnavailableError,
  readAnswer,
  type LibBackend,
  type LibLoadedMessage,
  type LibResponse,
  type WasmFunctionName,
  type WorkerBackendEvent,
} from "@cardananium/cquisitor-lib";
import {
  createLibWorkerBackend,
  HARD_TIMEOUT_MS,
  hardTimeoutFor,
  passDeadlineNotice,
  SOFT_TIMEOUT_MS,
  withSlowNotice,
} from "./index";

interface FakeBehaviour {
  /**
   * How the module load goes: `ok` announces it at once; `never` stays silent,
   * as while the wasm is still downloading; `error` raises an error event, as a
   * worker chunk that answers 404 does; `wasm-error` reports the wasm failed.
   */
  load?: "ok" | "never" | "error" | "wasm-error";
  /** Never answers a request. */
  stuck?: boolean;
  /** Answers every request with a trap, which poisons the instance. */
  trap?: boolean;
  /** Dies on the first request, after its module loaded. */
  crash?: boolean;
  /** Answers each request this many ms after it arrives, as a pass that takes that long. */
  delayMs?: number;
}

type Listener = (event: { data?: unknown; error?: unknown; type?: string }) => void;

/** A Web-style worker that loads and answers as told. */
function fakeWorker(behaviour: FakeBehaviour = {}) {
  const listeners = new Map<string, Set<Listener>>();
  const emit = (type: string, event: Parameters<Listener>[0]) => {
    for (const l of listeners.get(type) ?? []) l(event);
  };
  const deliver = (data: unknown) => emit("message", { data });
  // Like `serveWasm`, requests that arrive before the module is in wait for it.
  let loaded = false;
  const waiting: unknown[] = [];
  const worker = {
    posted: [] as unknown[],
    terminated: false,
    postMessage(message: unknown) {
      worker.posted.push(message);
      if (!loaded) {
        waiting.push(message);
        return;
      }
      answer(message);
    },
    addEventListener(type: string, listener: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
    terminate() {
      worker.terminated = true;
    },
  };
  function answer(message: unknown): void {
    if (worker.terminated || behaviour.stuck || !isLibRequest(message)) return;
    if (behaviour.crash) {
      queueMicrotask(() => emit("error", { type: "error", error: new Error("worker ran out of memory") }));
      return;
    }
    const reply: LibResponse = behaviour.trap
      ? {
          id: message.id,
          gen: message.gen,
          ok: false,
          error: { name: "RuntimeError", message: "unreachable", fatal: true },
        }
      : { id: message.id, gen: message.gen, ok: true, value: `answer to ${message.fn}` };
    if (behaviour.delayMs === undefined) queueMicrotask(() => deliver(reply));
    else setTimeout(() => worker.terminated || deliver(reply), behaviour.delayMs);
  }
  queueMicrotask(() => {
    switch (behaviour.load ?? "ok") {
      case "ok":
        loaded = true;
        deliver({ type: "loaded" } satisfies LibLoadedMessage);
        for (const message of waiting.splice(0)) answer(message);
        break;
      case "error":
        emit("error", { type: "error" });
        break;
      case "wasm-error":
        deliver({
          type: "loaded",
          error: { name: "CompileError", message: "the wasm did not arrive", fatal: false },
        } satisfies LibLoadedMessage);
        break;
      case "never":
        break;
    }
  });
  return worker;
}

/** A spawn that makes a fresh fake each time, per `behaviour(n)` for the n-th spawn. */
function spawner(behaviour: (n: number) => FakeBehaviour = () => ({})) {
  const workers: ReturnType<typeof fakeWorker>[] = [];
  return {
    workers,
    spawn: () => {
      const worker = fakeWorker(behaviour(workers.length));
      workers.push(worker);
      return worker;
    },
  };
}

/** Stand-in for the library on the page's own thread; these tests do not load the real wasm for it. */
function countingFallback() {
  const calls: WasmFunctionName[] = [];
  let built = 0;
  const factory = (): LibBackend => {
    built++;
    return {
      async callRaw<T>(fn: WasmFunctionName): Promise<T> {
        calls.push(fn);
        return "in process" as T;
      },
    };
  };
  return { calls, factory, built: () => built };
}

const settle = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

describe("hardTimeoutFor", () => {
  test("a document pass gets the base budget", () => {
    expect(hardTimeoutFor("cbor_to_json")).toBe(HARD_TIMEOUT_MS);
  });

  test("script evaluation gets a budget of its own, as a multiple of the base", () => {
    expect(hardTimeoutFor("validate_transaction_js")).toBe(HARD_TIMEOUT_MS * 6);
    expect(hardTimeoutFor("validate_transaction_js", 50)).toBe(300);
  });
});

describe("createLibWorkerBackend", () => {
  test("answers through the worker it was told to spawn", async () => {
    const worker = fakeWorker();
    const backend = createLibWorkerBackend({ spawn: () => worker });
    expect(await backend.callRaw<string>("cbor_to_json", ["00"])).toBe("answer to cbor_to_json");
    expect(backend.stats().spawns).toBe(1);
    await backend.dispose();
    expect(worker.terminated).toBe(true);
  });

  test("the app's budgets are the ones the watchdog applies, per function", async () => {
    const events: WorkerBackendEvent[] = [];
    const backend = createLibWorkerBackend({
      spawn: () => fakeWorker({ stuck: true }),
      timeoutMs: 40,
      onEvent: e => events.push(e),
    });
    await expect(backend.callRaw("cbor_to_json", ["00"])).rejects.toBeInstanceOf(LibTimeoutError);
    await expect(backend.callRaw("validate_transaction_js", ["00", "{}"])).rejects.toBeInstanceOf(LibTimeoutError);
    const budgets = events.filter(e => e.type === "timeout").map(e => (e.type === "timeout" ? [e.fn, e.budgetMs] : null));
    expect(budgets).toEqual([
      ["cbor_to_json", 40],
      ["validate_transaction_js", 240],
    ]);
    // Each abandoned pass cost a worker, not the page.
    expect(backend.stats().spawns).toBe(2);
    await backend.dispose();
  });
});

describe("the deadline a panel describes", () => {
  test("is one budget from when the pass was asked, not a wait limit plus a run limit", () => {
    const text = passDeadlineNotice();
    expect(HARD_TIMEOUT_MS).toBe(10_000);
    expect(text).toContain("has 10 s in all, counted from when it was asked");
    expect(text).toContain("time spent waiting behind earlier passes counts");
    expect(text).toContain("time spent loading the library does not");
    expect(text).toContain("one still waiting its turn when too little of that time is left never starts");
    expect(text).not.toMatch(/waiting its turn, or [^.]* running/);
    expect(text).not.toContain("ten seconds");
  });

  test("names the budget it is given", () => {
    expect(passDeadlineNotice(300)).toContain("has 300 ms in all");
    expect(passDeadlineNotice(2_500)).toContain("has 2.5 s in all");
    expect(passDeadlineNotice(60_000)).toContain("has 60 s in all");
  });

  test("is what the backend does: a pass that waited gets only what is left, one left with none never runs", async () => {
    // Each pass takes 250 ms against a 400 ms deadline; three are asked at once.
    const { workers, spawn } = spawner(() => ({ delayMs: 250 }));
    const backend = createLibWorkerBackend({ spawn, timeoutMs: 400, fallback: undefined });
    const started = performance.now();
    const [first, second, third] = await Promise.allSettled([
      backend.callRaw<string>("validate_cddl", ["a"]),
      backend.callRaw<string>("validate_cddl", ["b"]),
      backend.callRaw<string>("validate_cddl", ["c"]),
    ]);
    const elapsed = performance.now() - started;
    expect(first).toEqual({ status: "fulfilled", value: "answer to validate_cddl" });
    // Two limits (400 ms to wait, then 400 ms to run) would have let it finish at 500 ms.
    expect(second.status).toBe("rejected");
    const secondError = (second as PromiseRejectedResult).reason as Error;
    expect(secondError).toBeInstanceOf(LibTimeoutError);
    expect(secondError.message).toContain("waiting for earlier calls to finish");
    expect(third.status).toBe("rejected");
    const thirdError = (third as PromiseRejectedResult).reason as Error;
    expect(thirdError).toBeInstanceOf(LibTimeoutError);
    expect(thirdError.message).toContain("never ran");
    // All three were settled at the one deadline, not a second one later.
    expect(elapsed).toBeLessThan(480);
    // The second pass was started (its worker was killed); the third never was.
    const requests = workers.flatMap(w => w.posted.filter(isLibRequest));
    expect(requests.map(r => r.args[0])).toEqual(["a", "b"]);
    await backend.dispose();
  });
});

describe("no worker to be had: the page runs the library itself", () => {
  test("a worker that cannot be started costs the page its watchdog, not the library", async () => {
    const fallback = countingFallback();
    let spawns = 0;
    const backend = createLibWorkerBackend({
      spawn: () => {
        spawns++;
        throw new Error("Worker is not allowed by the page's Content-Security-Policy");
      },
      fallback: fallback.factory,
    });
    for (let i = 0; i < 5; i++) {
      expect(await backend.callRaw<string>("cbor_to_json", ["01"])).toBe("in process");
    }
    expect(fallback.calls).toEqual(Array(5).fill("cbor_to_json"));
    // Not retried on every call: after a run of failures the page stops asking for a while.
    expect(spawns).toBe(3);
    expect(backend.stats().fallbackCalls).toBe(5);
    await backend.dispose();
  });

  test("the fallback is built once, however many calls need it", async () => {
    const fallback = countingFallback();
    const backend = createLibWorkerBackend({
      spawn: () => {
        throw new Error("404");
      },
      fallback: fallback.factory,
    });
    await Promise.all([
      backend.callRaw("cbor_to_json", ["01"]),
      backend.callRaw("cbor_to_json", ["02"]),
      backend.callRaw("decode_specific_type", ["00", "Transaction"]),
    ]);
    await backend.callRaw("cbor_to_json", ["03"]);
    expect(fallback.built()).toBe(1);
    expect(fallback.calls.length).toBe(4);
    await backend.dispose();
  });

  test("a worker chunk that will not load is tried a few times, then the call runs on the page", async () => {
    const fallback = countingFallback();
    const { workers, spawn } = spawner(() => ({ load: "error" }));
    const backend = createLibWorkerBackend({ spawn, fallback: fallback.factory });
    expect(await backend.callRaw<string>("cbor_to_json", ["01"])).toBe("in process");
    expect(workers.length).toBe(3);
    expect(workers.every(w => w.terminated)).toBe(true);
    // No request ever reached a worker that had not loaded.
    expect(workers.flatMap(w => w.posted.filter(isLibRequest)).length).toBe(3);
    // While the page waits before trying again, nothing is spawned and the calls still answer.
    expect(await backend.callRaw<string>("cbor_to_json", ["02"])).toBe("in process");
    expect(workers.length).toBe(3);
    await backend.dispose();
  });

  test("a worker whose wasm did not load is treated as one that could not start", async () => {
    const fallback = countingFallback();
    const { workers, spawn } = spawner(() => ({ load: "wasm-error" }));
    const backend = createLibWorkerBackend({ spawn, fallback: fallback.factory });
    expect(await backend.callRaw<string>("cbor_to_json", ["01"])).toBe("in process");
    expect(workers.length).toBe(3);
    expect(fallback.calls.length).toBe(1);
    await backend.dispose();
  });

  test("a module that never arrives costs the page its worker, not the pass, and is not downloaded again", async () => {
    const fallback = countingFallback();
    const { workers, spawn } = spawner(() => ({ load: "never" }));
    const backend = createLibWorkerBackend({ spawn, loadTimeoutMs: 20, fallback: fallback.factory });
    expect(await backend.callRaw<string>("cbor_to_json", ["01"])).toBe("in process");
    expect(workers[0].terminated).toBe(true);
    expect(await backend.callRaw<string>("cbor_to_json", ["02"])).toBe("in process");
    expect(workers.length).toBe(1);
    expect(fallback.calls.length).toBe(2);
    await backend.dispose();
  });

  test("a worker is tried again once the run of failures is behind it", async () => {
    const fallback = countingFallback();
    // The first worker's wasm never arrives; later ones load at once.
    const { workers, spawn } = spawner(n => (n === 0 ? { load: "never" } : {}));
    const backend = createLibWorkerBackend({
      spawn,
      loadTimeoutMs: 20,
      retryAfterMs: 30,
      fallback: fallback.factory,
    });
    expect(await backend.callRaw<string>("cbor_to_json", ["01"])).toBe("in process");
    await settle(60);
    expect(await backend.callRaw<string>("cbor_to_json", ["02"])).toBe("answer to cbor_to_json");
    expect(workers.length).toBe(2);
    expect(fallback.calls.length).toBe(1);
    await backend.dispose();
  });

  test("a pass abandoned for its own cost does not push the next one onto the page", async () => {
    // A runaway pass on the page's thread could not be stopped; it must get a fresh worker instead.
    const fallback = countingFallback();
    const { workers, spawn } = spawner(() => ({ stuck: true }));
    const backend = createLibWorkerBackend({ spawn, timeoutMs: 10, fallback: fallback.factory });
    for (let i = 0; i < 4; i++) {
      await expect(backend.callRaw("cbor_to_json", ["01"])).rejects.toBeInstanceOf(LibTimeoutError);
    }
    expect(fallback.calls.length).toBe(0);
    expect(workers.length).toBe(4);
    await backend.dispose();
  });

  test("a trap costs a worker, not the page's own instance", async () => {
    const fallback = countingFallback();
    const { workers, spawn } = spawner(() => ({ trap: true }));
    const backend = createLibWorkerBackend({ spawn, fallback: fallback.factory });
    for (let i = 0; i < 4; i++) {
      const error = await backend.callRaw("cbor_to_json", ["01"]).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("unreachable");
    }
    expect(fallback.calls.length).toBe(0);
    expect(workers.length).toBe(4);
    await backend.dispose();
  });

  test("a worker that dies in the middle of a pass is reported, not rerun on the page", async () => {
    // The pass may be what killed it; on the page it would take the tab down instead.
    const fallback = countingFallback();
    const { workers, spawn } = spawner(() => ({ crash: true }));
    const backend = createLibWorkerBackend({ spawn, fallback: fallback.factory });
    for (let i = 0; i < 4; i++) {
      const error = await backend.callRaw("cbor_to_json", ["01"]).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(LibUnavailableError);
      expect((error as Error).message).toMatch(/stopped while decoding the CBOR/);
    }
    // Each pass got a fresh worker; none ran on the page.
    expect(workers.length).toBe(4);
    expect(fallback.calls.length).toBe(0);
    await backend.dispose();
  });

  test("without a fallback the call still says why it could not run", async () => {
    const backend = createLibWorkerBackend({
      spawn: () => {
        throw new Error("404");
      },
      fallback: undefined,
    });
    const error = await backend.callRaw("cbor_to_json", ["01"]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(LibUnavailableError);
    expect((error as Error).message).toMatch(/could not be started/);
    expect((error as Error).message).toContain("404");
    await backend.dispose();
  });

  test("the page's own fallback is the library running on this thread", async () => {
    const events: WorkerBackendEvent[] = [];
    const backend = createLibWorkerBackend({
      spawn: () => {
        throw new Error("module workers are not supported here");
      },
      onEvent: e => events.push(e),
    });
    const raw = await backend.callRaw("cbor_to_json", ["83010203"]);
    const answer = readAnswer<{ ok: boolean; value: { type: string; items: number } }>("cbor_to_json", raw);
    expect(answer.ok).toBe(true);
    expect(answer.value.type).toBe("Array");
    expect(answer.value.items).toBe(3);
    expect(backend.stats().fallbackCalls).toBe(1);
    expect(events.some(e => e.type === "fallback" && e.fn === "cbor_to_json")).toBe(true);
    await backend.dispose();
  });

  test("with the page's own fallback in place, a pass that overruns its budget still only costs a worker", async () => {
    const { workers, spawn } = spawner(() => ({ stuck: true }));
    const backend = createLibWorkerBackend({ spawn, timeoutMs: 10 });
    for (let i = 0; i < 3; i++) {
      await expect(backend.callRaw("cbor_to_json", ["01"])).rejects.toBeInstanceOf(LibTimeoutError);
    }
    expect(workers.length).toBe(3);
    expect(backend.stats().fallbackCalls).toBe(0);
    await backend.dispose();
  });
});

describe("withSlowNotice", () => {
  test("says so before a slow pass is given up on, then settles with the answer", async () => {
    let slow = false;
    const value = await withSlowNotice(
      { onSlow: () => (slow = true) },
      () => new Promise<string>(resolve => setTimeout(() => resolve("done"), 30)),
      5,
    );
    expect(value).toBe("done");
    expect(slow).toBe(true);
  });

  test("a pass that finishes first never reports itself as slow", async () => {
    let slow = false;
    await withSlowNotice({ onSlow: () => (slow = true) }, () => Promise.resolve(1), 20);
    await new Promise(r => setTimeout(r, 40));
    expect(slow).toBe(false);
  });

  test("a pass that fails does not report itself as slow afterwards either", async () => {
    let slow = false;
    await expect(
      withSlowNotice({ onSlow: () => (slow = true) }, () => Promise.reject(new Error("no")), 5),
    ).rejects.toThrow("no");
    await new Promise(r => setTimeout(r, 20));
    expect(slow).toBe(false);
  });

  test("the library sees the signal and the budget, never the notice", async () => {
    const controller = new AbortController();
    let seen: unknown;
    await withSlowNotice({ signal: controller.signal, timeoutMs: 7, onSlow: () => {} }, options => {
      seen = options;
      return Promise.resolve(null);
    });
    expect(seen).toEqual({ signal: controller.signal, timeoutMs: 7 });
  });

  test("without a notice the options go through as they are", async () => {
    let seen: unknown;
    await withSlowNotice(undefined, options => {
      seen = options;
      return Promise.resolve(null);
    });
    expect(seen).toEqual({});
  });

  test("the default soft budget is the one panels are written for", () => {
    expect(SOFT_TIMEOUT_MS).toBe(2_000);
  });
});
