import { afterEach, describe, expect, mock, test } from "bun:test";
import { cddl_outline, validate_cbor_against_cddl, validate_cddl } from "@cardananium/cquisitor-lib";
import {
  CARDANO_PRESETS,
  LEDGER_REV,
  LEDGER_REV_SHORT,
  PRESET_FETCH_TIMEOUT_MS,
  classifyPresetFetchFailure,
  confirmReplaceMessage,
  describePresetFetchFailure,
  describePresetLoad,
  loadCardanoPreset,
  type PresetLoad,
} from "./presets";
import { CONWAY_CDDL } from "./conwaySchema";
import { CONWAY_TX_HEX, PERSON_SCHEMA } from "./libForTests";

const CACHE_PREFIX = "cquisitor:cddl-preset:";
const CONWAY = CARDANO_PRESETS.find(p => p.id === "conway")!;
/** An era that is fetched rather than bundled — the network paths need one. */
const BABBAGE = CARDANO_PRESETS.find(p => p.id === "babbage")!;

const realFetch = globalThis.fetch;

/** A `fetch` that answers every call with `body`, and counts the calls. */
function stubFetch(body: string, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  const fn = mock(async (...args: unknown[]) => {
    void args;
    return new Response(body, { status });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** A `fetch` that never answers, and rejects the way a real one does when aborted. */
function stubHangingFetch() {
  const fn = mock((_url: unknown, init?: { signal?: AbortSignal }) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      signal.addEventListener("abort", () => {
        reject(signal.reason ?? new DOMException("aborted", "AbortError"));
      });
    });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** A `fetch` that fails the way one does with no route to the host. */
function stubOfflineFetch() {
  const fn = mock(async () => {
    throw new TypeError("Failed to fetch");
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** sessionStorage behaviour presets.ts depends on, including quota / blocked-storage failures. */
function stubSessionStorage(opts: { failWrites?: boolean; failReads?: boolean } = {}) {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => {
      if (opts.failReads) throw new Error("SecurityError");
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (opts.failWrites) throw new Error("QuotaExceededError");
      store.set(k, v);
    },
  };
  globalThis.sessionStorage = stub as unknown as Storage;
  return store;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
});

describe("CARDANO_PRESETS", () => {
  test("ids are unique and every era has a root rule", () => {
    const ids = CARDANO_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of CARDANO_PRESETS) {
      expect(p.rootRule.length).toBeGreaterThan(0);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  test("every schema is pinned to one ledger commit, not a branch", () => {
    expect(LEDGER_REV).toMatch(/^[0-9a-f]{40}$/);
    expect(LEDGER_REV_SHORT).toBe(LEDGER_REV.slice(0, 7));
    for (const p of CARDANO_PRESETS) {
      expect(p.url).toBe(
        `https://raw.githubusercontent.com/IntersectMBO/cardano-ledger/${LEDGER_REV}/eras/${p.id}/impl/cddl/data/${p.id}.cddl`,
      );
      // A moving ref would make a preset mean something different tomorrow.
      expect(p.url).not.toContain("/master/");
      expect(p.url).not.toContain("/main/");
    }
  });

  test("the root rule is one every era declares", () => {
    // `block` is the first rule of each era schema, not what a pasted transaction is.
    for (const p of CARDANO_PRESETS) expect(p.rootRule).toBe("transaction");
  });

  test("Conway is the era that ships with the app", () => {
    expect(typeof CONWAY.bundled).toBe("function");
    for (const p of CARDANO_PRESETS) {
      if (p.id !== "conway") expect(p.bundled).toBeUndefined();
    }
  });
});

describe("the bundled schema", () => {
  test("the bundled Conway schema is the ledger schema and parses", () => {
    expect(CONWAY_CDDL).toContain("This file was auto-generated using generate-cddl");
    // Escaping the vendored text as a JS string must not eat the byte escapes in its comments.
    expect(CONWAY_CDDL).toContain('"\\x00" for multisig/native scripts');
    expect(validate_cddl(CONWAY_CDDL)).toEqual({ valid: true });
    const names = (cddl_outline(CONWAY_CDDL) as { name: string }[]).map(e => e.name);
    expect(names).toContain(CONWAY.rootRule);
  });

  test("the transaction the tests use validates against the bundled schema", () => {
    expect(JSON.parse(validate_cbor_against_cddl(CONWAY_TX_HEX, CONWAY_CDDL, CONWAY.rootRule)))
      .toEqual({ valid: true });
  });
});

describe("loadCardanoPreset", () => {
  test("an id that isn't a preset is refused without a network call", async () => {
    const fetched = stubFetch("");
    await expect(loadCardanoPreset("nope")).rejects.toThrow("Unknown preset: nope");
    expect(fetched).toHaveBeenCalledTimes(0);
  });

  test("the bundled era needs no network at all", async () => {
    const fetched = stubFetch("not this");
    expect(await loadCardanoPreset("conway")).toBe(CONWAY_CDDL);
    expect(fetched).toHaveBeenCalledTimes(0);
  });

  test("returns the schema body from the preset's own url", async () => {
    const fetched = stubFetch("transaction = [1]\n");
    expect(await loadCardanoPreset("babbage")).toBe("transaction = [1]\n");
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(fetched.mock.calls[0][0]).toBe(BABBAGE.url);
  });

  test("the request carries an abort signal", async () => {
    const fetched = stubFetch("transaction = [1]\n");
    await loadCardanoPreset("babbage");
    const init = fetched.mock.calls[0][1] as { signal?: AbortSignal };
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(false);
  });

  test("a request that hangs is given up on and says so", async () => {
    const fetched = stubHangingFetch();
    await expect(loadCardanoPreset("babbage", { timeoutMs: 5 })).rejects.toThrow(
      "Babbage could not be loaded — raw.githubusercontent.com did not answer within 5 ms.",
    );
    const init = fetched.mock.calls[0][1] as { signal: AbortSignal };
    expect(init.signal.aborted).toBe(true);
  });

  test("a request that never reaches a server reports the network, not a status", async () => {
    stubOfflineFetch();
    const message = await loadCardanoPreset("babbage").catch((e: Error) => e.message);
    expect(message).toContain("failed before it reached a server");
    expect(message).toContain("You are offline, or the domain is blocked");
    // The way out of an unreachable network is the era that needs none.
    expect(message).toContain("The Conway preset ships with the app rather than being downloaded.");
    expect(message).not.toContain("Failed to fetch");
  });

  test("a failed request names the era and the status", async () => {
    stubFetch("not found", { status: 404 });
    await expect(loadCardanoPreset("mary")).rejects.toThrow(
      "Mary could not be loaded — raw.githubusercontent.com answered HTTP 404.",
    );
  });

  test("the second load of an era comes from the session cache", async () => {
    const store = stubSessionStorage();
    const fetched = stubFetch("transaction = [1]\n");
    await loadCardanoPreset("babbage");
    expect(store.get(CACHE_PREFIX + "babbage")).toBe("transaction = [1]\n");
    expect(await loadCardanoPreset("babbage")).toBe("transaction = [1]\n");
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  test("each era is cached under its own key", async () => {
    stubSessionStorage();
    const fetched = stubFetch("transaction = [1]\n");
    await loadCardanoPreset("babbage");
    await loadCardanoPreset("alonzo");
    expect(fetched).toHaveBeenCalledTimes(2);
  });

  test("a failed load is not cached", async () => {
    const store = stubSessionStorage();
    stubFetch("not found", { status: 404 });
    await expect(loadCardanoPreset("babbage")).rejects.toThrow();
    expect(store.size).toBe(0);
  });

  test("without a session cache every load goes to the network", async () => {
    const fetched = stubFetch("transaction = [1]\n");
    await loadCardanoPreset("babbage");
    await loadCardanoPreset("babbage");
    expect(fetched).toHaveBeenCalledTimes(2);
  });

  test("a cache that refuses to store still hands the schema back", async () => {
    stubSessionStorage({ failWrites: true });
    stubFetch("transaction = [1]\n");
    expect(await loadCardanoPreset("babbage")).toBe("transaction = [1]\n");
  });

  test("a cache that refuses to be read still hands the schema back", async () => {
    stubSessionStorage({ failReads: true });
    stubFetch("transaction = [1]\n");
    expect(await loadCardanoPreset("babbage")).toBe("transaction = [1]\n");
  });
});

describe("classifyPresetFetchFailure", () => {
  test("our own timer firing is a timeout, whatever fetch then threw", () => {
    expect(classifyPresetFetchFailure(new Error("boom"), true, 15_000))
      .toEqual({ kind: "timeout", afterMs: 15_000 });
  });

  test("an abort is a timeout — this code issues no other kind", () => {
    const aborted = new DOMException("aborted", "AbortError");
    expect(classifyPresetFetchFailure(aborted, false, 900))
      .toEqual({ kind: "timeout", afterMs: 900 });
  });

  test("a TypeError is the request never leaving the machine", () => {
    expect(classifyPresetFetchFailure(new TypeError("Failed to fetch"), false, 1))
      .toEqual({ kind: "offline" });
  });

  test("anything else is passed through with its own message", () => {
    expect(classifyPresetFetchFailure(new Error("odd"), false, 1))
      .toEqual({ kind: "other", message: "odd" });
    expect(classifyPresetFetchFailure("odd", false, 1))
      .toEqual({ kind: "other", message: "odd" });
  });
});

describe("describePresetFetchFailure", () => {
  test("a timeout is reported in seconds once it is worth seconds", () => {
    expect(describePresetFetchFailure("Mary", { kind: "timeout", afterMs: PRESET_FETCH_TIMEOUT_MS }))
      .toContain("did not answer within 15 seconds");
  });

  test("the offline alternative is only named when there is one", () => {
    const failure = { kind: "offline" } as const;
    expect(describePresetFetchFailure("Mary", failure, "Conway"))
      .toContain("The Conway preset ships with the app rather than being downloaded.");
    expect(describePresetFetchFailure("Mary", failure))
      .not.toContain("ships with the app");
  });

  test("a status code is a server's answer, not a network failure", () => {
    // Suggesting the offline copy would be wrong: the network is fine, the file moved.
    const text = describePresetFetchFailure("Mary", { kind: "http", status: 404 }, "Conway");
    expect(text).toBe("Mary could not be loaded — raw.githubusercontent.com answered HTTP 404.");
  });
});

describe("describePresetLoad", () => {
  const load = (over: Partial<PresetLoad> = {}): PresetLoad =>
    ({ label: "Conway", requestedRule: "transaction", ...over });

  test("names the requested rule when that is what runs", () => {
    expect(describePresetLoad(load(), "transaction", false))
      .toBe("Conway loaded — root rule transaction.");
  });

  test("names the rule that actually runs when the schema has no such root", () => {
    // Preset asks for `transaction`; a schema that does not declare it falls back to its first root.
    const text = describePresetLoad(load(), "block", false);
    expect(text).toContain("declares no transaction");
    expect(text).toContain("so block is what this validates against");
  });

  test("claims nothing about a schema that has not been parsed yet", () => {
    // While settling, the rule in effect still belongs to the schema being replaced.
    expect(describePresetLoad(load(), "Person", true))
      .toBe("Conway loaded — root rule transaction.");
  });

  test("says so when the schema offers no root at all", () => {
    expect(describePresetLoad(load(), "", false))
      .toContain("no other rule that could be a root");
  });

  test("a preset that names no rule reports what happened instead", () => {
    expect(describePresetLoad(load({ requestedRule: null }), "block", false))
      .toBe("Conway loaded — root rule picked from the schema.");
  });
});

describe("confirmReplaceMessage", () => {
  test("nothing is asked when the editor holds what the app put there", () => {
    expect(confirmReplaceMessage(PERSON_SCHEMA, PERSON_SCHEMA, "the Conway schema")).toBeNull();
  });

  test("nothing is asked when the editor is empty", () => {
    expect(confirmReplaceMessage("", PERSON_SCHEMA, "the Conway schema")).toBeNull();
    expect(confirmReplaceMessage("  \n ", null, "the Conway schema")).toBeNull();
  });

  test("an edited schema is asked about by name", () => {
    expect(confirmReplaceMessage("Person = {a: int}", PERSON_SCHEMA, "the Conway schema"))
      .toBe("Replace the schema you have edited with the Conway schema? Undo puts it back.");
  });

  test("a schema with no app-authored original is always the reader's", () => {
    // `null` is recorded once origin is unknown — a formatted or restored schema counts as user work.
    expect(confirmReplaceMessage(PERSON_SCHEMA, null, "an empty editor")).not.toBeNull();
  });
});
