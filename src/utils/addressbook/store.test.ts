import { describe, expect, test } from "bun:test";
import {
  BOOK_STORAGE_KEY,
  createAddressBookStore,
  parseBook,
  sanitizeEntry,
  serializeBook,
  type BookStorage,
} from "./store";

const ADDRESS = "addr1qy8ac7qqy0vtulyl7wntmsxc6wex80akj3nw3dmh3qpz0j9qxh2";
const CRED = "aa11bb22cc33dd44ee55ff6677889900112233445566778899aabbcc";

function memoryStorage(data: Record<string, string> = {}) {
  return {
    data,
    getItem(key: string) {
      return key in data ? data[key] : null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
}

describe("sanitizeEntry", () => {
  test("an entry needs a label and something to match", () => {
    expect(sanitizeEntry({ label: "x" })).toBeNull();
    expect(sanitizeEntry({ address: ADDRESS })).toBeNull();
    expect(sanitizeEntry({ label: "   ", address: ADDRESS })).toBeNull();
    expect(sanitizeEntry(sanitizeEntry({ label: "x", address: ADDRESS }))).not.toBeNull();
  });

  test("an address is lowercased and a non-address is dropped", () => {
    expect(sanitizeEntry({ label: "x", address: ADDRESS.toUpperCase() })?.address).toBe(ADDRESS);
    expect(sanitizeEntry({ label: "x", address: "not an address", cred: CRED })?.address).toBeUndefined();
  });

  test("a credential must be 28 bytes of hex", () => {
    expect(sanitizeEntry({ label: "x", cred: CRED.toUpperCase() })?.cred).toBe(CRED);
    expect(sanitizeEntry({ label: "x", cred: "abc", address: ADDRESS })?.cred).toBeUndefined();
    expect(sanitizeEntry({ label: "x", cred: `${CRED}00` })).toBeNull();
  });

  test("a label is capped and freed of control characters", () => {
    const entry = sanitizeEntry({ label: `ab${"c".repeat(200)}`, address: ADDRESS });
    expect(entry!.label.length).toBe(64);
    expect(entry!.label.startsWith("a b")).toBe(true);
  });
});

describe("parseBook", () => {
  test("it reads an exported document and a bare list alike", () => {
    const entries = [{ label: "x", address: ADDRESS, addedAt: 1, id: "e1" }];
    expect(parseBook(JSON.stringify({ version: 1, entries })).length).toBe(1);
    expect(parseBook(JSON.stringify(entries)).length).toBe(1);
  });

  test("anything else reads as empty", () => {
    expect(parseBook(null)).toEqual([]);
    expect(parseBook("not json")).toEqual([]);
    expect(parseBook("{}")).toEqual([]);
    expect(parseBook(JSON.stringify([{ label: "no target" }]))).toEqual([]);
  });

  test("a round trip keeps every entry", () => {
    const entries = parseBook(JSON.stringify([{ label: "x", address: ADDRESS, cred: CRED }]));
    expect(parseBook(serializeBook(entries))).toEqual(entries);
  });
});

describe("the store", () => {
  test("a save is written under the key and read back on the next start", () => {
    const storage = memoryStorage();
    const store = createAddressBookStore(() => storage);
    store.add({ label: "My wallet", address: ADDRESS, cred: CRED, credType: "KeyHash" });
    expect(Object.keys(storage.data)).toEqual([BOOK_STORAGE_KEY]);
    const reopened = createAddressBookStore(() => storage);
    expect(reopened.entries().length).toBe(1);
    expect(reopened.entries()[0].label).toBe("My wallet");
  });

  test("saving the same address twice relabels the entry", () => {
    const store = createAddressBookStore(() => memoryStorage());
    const first = store.add({ label: "first", address: ADDRESS });
    const second = store.add({ label: "second", address: ADDRESS });
    expect(store.entries().length).toBe(1);
    expect(second?.id).toBe(first!.id);
    expect(store.entries()[0].label).toBe("second");
  });

  test("the index follows the list", () => {
    const store = createAddressBookStore(() => memoryStorage());
    expect(store.index().byAddress.size).toBe(0);
    store.add({ label: "x", address: ADDRESS });
    expect(store.index().byAddress.get(ADDRESS)?.label).toBe("x");
    store.remove(store.entries()[0].id);
    expect(store.index().byAddress.size).toBe(0);
  });

  test("an update keeps the rest of the entry, and an empty label is refused", () => {
    const store = createAddressBookStore(() => memoryStorage());
    const saved = store.add({ label: "x", address: ADDRESS, cred: CRED })!;
    store.update(saved.id, { label: "renamed", note: "cold storage" });
    expect(store.entries()[0]).toMatchObject({ label: "renamed", note: "cold storage", cred: CRED });
    store.update(saved.id, { label: "  " });
    expect(store.entries()[0].label).toBe("renamed");
  });

  test("a version rises on every change and subscribers hear it", () => {
    const store = createAddressBookStore(() => memoryStorage());
    let heard = 0;
    const stop = store.subscribe(() => heard++);
    const before = store.version();
    store.add({ label: "x", address: ADDRESS });
    expect(store.version()).toBeGreaterThan(before);
    expect(heard).toBe(1);
    stop();
    store.clear();
    expect(heard).toBe(1);
  });

  test("an import merges, relabels, and reports what it dropped", () => {
    const store = createAddressBookStore(() => memoryStorage());
    store.add({ label: "mine", address: ADDRESS });
    const report = store.importJson(
      JSON.stringify({
        version: 1,
        entries: [
          { label: "theirs", address: ADDRESS },
          { label: "a contract", cred: CRED },
          { label: "no target" },
        ],
      }),
      "merge",
    );
    expect(report).toEqual({ added: 1, updated: 1, skipped: 1 });
    expect(store.entries().length).toBe(2);
    expect(store.index().byAddress.get(ADDRESS)?.label).toBe("theirs");
  });

  test("an import that replaces drops what was there", () => {
    const store = createAddressBookStore(() => memoryStorage());
    store.add({ label: "mine", address: ADDRESS });
    store.importJson(JSON.stringify([{ label: "a contract", cred: CRED }]), "replace");
    expect(store.entries().length).toBe(1);
    expect(store.entries()[0].label).toBe("a contract");
  });

  test("a storage that throws loses the write and nothing else", () => {
    const angry: BookStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    const store = createAddressBookStore(() => angry);
    expect(store.entries()).toEqual([]);
    expect(store.add({ label: "x", address: ADDRESS })).not.toBeNull();
    expect(store.entries().length).toBe(1);
  });

  test("no storage at all still keeps the book for this page", () => {
    const store = createAddressBookStore(() => null);
    store.add({ label: "x", address: ADDRESS });
    expect(store.entries().length).toBe(1);
  });
});
