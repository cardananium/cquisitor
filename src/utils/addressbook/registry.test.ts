import { describe, expect, test } from "bun:test";
import { createRegistryStore, REGISTRY_LIVE_KEY, REGISTRY_TTL_MS } from "./registry";
import { parseScriptIndex, sanitizeText } from "./registryData";

const HASH_A = "4020e7fc2de75a0729c3cc3af715b34d98381e0cdbcfa99c950bc3ac";
const HASH_B = "0029cb7c88c7567b63d1a512c0ed626aa169688ec980730c0473b913";

function index(rows: Record<string, unknown>, projects: Record<string, unknown> = {}) {
  return { metadata: { generatedAt: "2026-06-05T00:00:00.000Z" }, projects, scripts: rows };
}

/** A document with enough scripts to pass the floor a fetched copy must clear. */
function bigIndex(count: number, name = "Fetched") {
  const scripts: Record<string, unknown> = {};
  for (let i = 0; i < count; i++) {
    scripts[i.toString(16).padStart(56, "0")] = ["acme", `${name} ${i}`, "SPEND"];
  }
  return index(scripts, { acme: { label: "Acme" } });
}

function memoryStorage(data: Record<string, string> = {}) {
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

function okResponse(body: unknown): Response {
  return {
    ok: true,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("parseScriptIndex", () => {
  test("it reads the snapshot's tuples and the upstream objects alike", () => {
    const tuples = parseScriptIndex(index({ [HASH_A]: ["acme", "Pool", "SPEND"] }), "snapshot")!;
    const objects = parseScriptIndex(
      index({ [HASH_A]: { projectId: "acme", name: "Pool", purpose: "SPEND", type: "PLUTUS" } }),
      "snapshot",
    )!;
    expect(tuples.scripts.get(HASH_A)).toEqual(objects.scripts.get(HASH_A));
    expect(tuples.scripts.get(HASH_A)).toMatchObject({ projectId: "acme", name: "Pool", purpose: "SPEND" });
  });

  test("a key of payment hash plus stake hash keeps both parts", () => {
    const key = HASH_A + HASH_B;
    const bundle = parseScriptIndex(index({ [key]: ["acme", "Order address"] }), "snapshot")!;
    expect(bundle.scripts.get(key)).toMatchObject({ hash: HASH_A, stakeHash: HASH_B });
  });

  test("a bad row costs its own label and nothing else", () => {
    const bundle = parseScriptIndex(
      index({
        [HASH_A]: ["acme", "Pool"],
        "not-a-hash": ["acme", "Pool"],
        [HASH_B]: ["acme", ""],
        ["ff".repeat(28)]: "a string, not a row",
      }),
      "snapshot",
    )!;
    expect([...bundle.scripts.keys()]).toEqual([HASH_A]);
  });

  test("a document that is not an index reads as nothing", () => {
    expect(parseScriptIndex(null, "snapshot")).toBeNull();
    expect(parseScriptIndex({ scripts: [] }, "snapshot")).toBeNull();
    expect(parseScriptIndex("{}", "snapshot")).toBeNull();
  });

  test("a project link must be http, and a label is capped", () => {
    const bundle = parseScriptIndex(
      index({ [HASH_A]: ["acme", "Pool"] }, {
        acme: { label: "A".repeat(200), link: "javascript:alert(1)" },
        evil: { label: "", link: "https://example.com" },
      }),
      "snapshot",
    )!;
    expect(bundle.projects.get("acme")!.label.length).toBe(64);
    expect(bundle.projects.get("acme")!.link).toBeUndefined();
    expect(bundle.projects.has("evil")).toBe(false);
  });

  test("sanitizeText keeps nothing from an empty or non-string value", () => {
    expect(sanitizeText(42, 10)).toBeNull();
    expect(sanitizeText("  ", 10)).toBeNull();
    expect(sanitizeText(" ok ", 10)).toBe("ok");
  });
});

describe("the registry store", () => {
  const snapshot = index({ [HASH_A]: ["acme", "Snapshot pool", "SPEND"] }, { acme: { label: "Acme" } });

  test("the snapshot answers first, with no network call", async () => {
    let calls = 0;
    const store = createRegistryStore({
      loadSnapshot: async () => snapshot,
      fetchIndex: async () => {
        calls++;
        return okResponse(bigIndex(300));
      },
      readCache: async () => undefined,
      writeCache: async () => {},
      storage: () => memoryStorage({ [REGISTRY_LIVE_KEY]: "false" }),
    });
    store.ensure();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.state().bundle.scripts.get(HASH_A)?.name).toBe("Snapshot pool");
    expect(store.state().bundle.source).toBe("snapshot");
    expect(calls).toBe(0);
  });

  test("a fetched copy replaces the snapshot and is cached", async () => {
    const written: unknown[] = [];
    const store = createRegistryStore({
      loadSnapshot: async () => snapshot,
      fetchIndex: async () => okResponse(bigIndex(300)),
      readCache: async () => undefined,
      writeCache: async (record) => {
        written.push(record);
      },
      storage: () => memoryStorage(),
      now: () => 1_000,
    });
    await store.refresh();
    expect(store.state().bundle.source).toBe("network");
    expect(store.state().bundle.scripts.size).toBe(300);
    expect(store.state().fetchedAt).toBe(1_000);
    expect(written.length).toBe(1);
    expect(store.state().error).toBeNull();
  });

  test("a fresh cache is used and nothing is fetched", async () => {
    let calls = 0;
    const store = createRegistryStore({
      loadSnapshot: async () => snapshot,
      fetchIndex: async () => {
        calls++;
        return okResponse(bigIndex(300, "Network"));
      },
      readCache: async () => ({ raw: bigIndex(300, "Cached"), at: 1_000 }),
      writeCache: async () => {},
      storage: () => memoryStorage(),
      now: () => 1_000 + REGISTRY_TTL_MS - 1,
    });
    store.ensure();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.state().bundle.scripts.size).toBe(300);
    expect([...store.state().bundle.scripts.values()][0].name.startsWith("Cached")).toBe(true);
    expect(calls).toBe(0);
  });

  test("a stale cache is refetched", async () => {
    const store = createRegistryStore({
      loadSnapshot: async () => snapshot,
      fetchIndex: async () => okResponse(bigIndex(300, "Network")),
      readCache: async () => ({ raw: bigIndex(300, "Cached"), at: 0 }),
      writeCache: async () => {},
      storage: () => memoryStorage(),
      now: () => REGISTRY_TTL_MS + 1,
    });
    store.ensure();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([...store.state().bundle.scripts.values()][0].name.startsWith("Network")).toBe(true);
  });

  test("a reply with too few scripts is dropped and the snapshot stands", async () => {
    const store = createRegistryStore({
      loadSnapshot: async () => snapshot,
      fetchIndex: async () => okResponse(bigIndex(3)),
      readCache: async () => undefined,
      writeCache: async () => {},
      storage: () => memoryStorage(),
    });
    await store.refresh();
    expect(store.state().bundle.source).toBe("snapshot");
    expect(store.state().bundle.scripts.get(HASH_A)?.name).toBe("Snapshot pool");
    expect(store.state().error).toBe("the reply is not a usable script index");
  });

  test("an HTTP failure leaves the snapshot and records why", async () => {
    const store = createRegistryStore({
      loadSnapshot: async () => snapshot,
      fetchIndex: async () => ({ ok: false, status: 503 }) as unknown as Response,
      readCache: async () => undefined,
      writeCache: async () => {},
      storage: () => memoryStorage(),
    });
    await store.refresh();
    expect(store.state().bundle.source).toBe("snapshot");
    expect(store.state().error).toBe("HTTP 503");
    expect(store.state().refreshing).toBe(false);
  });

  test("the choice about the refresh is written under its own key", () => {
    const storage = memoryStorage();
    const store = createRegistryStore({
      loadSnapshot: async () => snapshot,
      fetchIndex: async () => okResponse(bigIndex(300)),
      readCache: async () => undefined,
      writeCache: async () => {},
      storage: () => storage,
    });
    expect(store.state().live).toBe(true);
    store.setLive(false);
    expect(storage.data).toEqual({ [REGISTRY_LIVE_KEY]: "false" });
    expect(store.state().live).toBe(false);
  });
});

describe("an explicit check before the first address", () => {
  const snapshot = { metadata: {}, projects: { acme: { label: "Acme" } }, scripts: { [HASH_A]: ["acme", "Snapshot pool"] } };

  test("the snapshot never replaces a copy already fetched", async () => {
    const store = createRegistryStore({
      loadSnapshot: async () => snapshot,
      fetchIndex: async () => okResponse(bigIndex(300, "Network")),
      readCache: async () => undefined,
      writeCache: async () => {},
      storage: () => memoryStorage(),
    });
    // "Check now" runs before any address asked for a label.
    await store.refresh();
    expect(store.state().bundle.source).toBe("network");
    // The first address then starts the load, which must not step back.
    store.ensure();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.state().bundle.source).toBe("network");
    expect(store.state().bundle.scripts.size).toBe(300);
  });

  test("turning the refresh on fetches once", async () => {
    let calls = 0;
    const store = createRegistryStore({
      loadSnapshot: async () => snapshot,
      fetchIndex: async () => {
        calls++;
        return okResponse(bigIndex(300));
      },
      readCache: async () => undefined,
      writeCache: async () => {},
      storage: () => memoryStorage({ [REGISTRY_LIVE_KEY]: "false" }),
    });
    store.setLive(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(1);
    expect(store.state().bundle.source).toBe("network");
  });
});
