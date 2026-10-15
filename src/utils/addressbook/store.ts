// The viewer's own address book: the labels they saved, kept in localStorage.
//
// The store holds one list and the indexes built from it, tells subscribers
// when the list changes, and reads storage on first use so nothing touches it
// before the page runs. Every write goes through `sanitizeEntry`, so a hand
// edited or imported file cannot put a surprising value in front of a label.

import { buildBookIndex, type BookIndex } from "./lookup";
import { sanitizeText } from "./registryData";
import type { AddressBookEntry, CredentialType } from "./types";

/** Where the book is kept. The suffix is the format, so a later format can migrate. */
export const BOOK_STORAGE_KEY = "cquisitor:addressbook:v1";

/** Format marker of an exported file. */
export const BOOK_FORMAT_VERSION = 1;

export const MAX_ENTRIES = 2_000;
export const MAX_LABEL = 64;
export const MAX_NOTE = 280;

/** A Cardano credential is 28 bytes. */
const CRED_PATTERN = /^[0-9a-f]{56}$/;

/** Bech32 address or reward account, as the decoder accepts them. */
const ADDRESS_PATTERN = /^(addr|stake)(_test)?1[02-9ac-hj-np-z]{10,}$/;

/** The part of `Storage` the book uses. */
export interface BookStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function browserBookStorage(): BookStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** What a caller hands over to save one address. */
export interface NewEntry {
  label: string;
  note?: string;
  address?: string;
  cred?: string;
  credType?: CredentialType;
}

export interface ImportReport {
  added: number;
  updated: number;
  /** Rows that failed a check, or that the cap left out. */
  skipped: number;
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // No crypto: the fallback below is only an identifier, never a secret.
  }
  return `ab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanAddress(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  return ADDRESS_PATTERN.test(text) ? text : undefined;
}

function cleanCred(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  return CRED_PATTERN.test(text) ? text : undefined;
}

/**
 * One entry, or null when nothing usable is left. An entry needs a label and
 * at least one of an address or a credential, or it could never match.
 */
export function sanitizeEntry(raw: unknown): AddressBookEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const label = sanitizeText(row.label, MAX_LABEL);
  if (!label) return null;
  const address = cleanAddress(row.address);
  const cred = cleanCred(row.cred);
  if (!address && !cred) return null;
  const credType = row.credType === "ScriptHash" || row.credType === "KeyHash" ? row.credType : undefined;
  const addedAt = typeof row.addedAt === "number" && Number.isFinite(row.addedAt) ? row.addedAt : Date.now();
  const id = sanitizeText(row.id, 64) ?? newId();
  const note = sanitizeText(row.note, MAX_NOTE) ?? undefined;
  return { id, label, note, address, cred, credType, addedAt };
}

/** The entries a stored or exported document holds. Anything else reads as empty. */
export function parseBook(raw: string | null | undefined): AddressBookEntry[] {
  if (!raw) return [];
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    return [];
  }
  const rows = Array.isArray(document)
    ? document
    : typeof document === "object" && document !== null && Array.isArray((document as { entries?: unknown }).entries)
      ? ((document as { entries: unknown[] }).entries)
      : null;
  if (!rows) return [];
  const entries: AddressBookEntry[] = [];
  for (const row of rows) {
    if (entries.length >= MAX_ENTRIES) break;
    const entry = sanitizeEntry(row);
    if (entry) entries.push(entry);
  }
  return entries;
}

export function serializeBook(entries: readonly AddressBookEntry[]): string {
  return JSON.stringify({ version: BOOK_FORMAT_VERSION, entries }, null, 2);
}

/** The entry an address or a credential already has, or undefined. */
function findSame(
  entries: readonly AddressBookEntry[],
  address: string | undefined,
  cred: string | undefined,
): AddressBookEntry | undefined {
  return entries.find(
    (entry) =>
      (address !== undefined && entry.address === address) ||
      (cred !== undefined && entry.address === undefined && entry.cred === cred),
  );
}

export interface AddressBookStore {
  entries(): readonly AddressBookEntry[];
  /** Indexes over the current list, rebuilt only when the list changes. */
  index(): BookIndex;
  /** Saves one address, or relabels the entry that already holds it. */
  add(input: NewEntry): AddressBookEntry | null;
  update(id: string, patch: { label?: string; note?: string }): void;
  remove(id: string): void;
  importJson(text: string, mode: "merge" | "replace"): ImportReport;
  exportJson(): string;
  clear(): void;
  subscribe(listener: () => void): () => void;
  /** Rises on every change; list it in a memo that reads the store. */
  version(): number;
}

export function createAddressBookStore(
  storage: () => BookStorage | null = browserBookStorage,
): AddressBookStore {
  let entries: AddressBookEntry[] | null = null;
  let index: BookIndex | null = null;
  let version = 0;
  const listeners = new Set<() => void>();

  const read = (): AddressBookEntry[] => {
    if (entries === null) {
      try {
        entries = parseBook(storage()?.getItem(BOOK_STORAGE_KEY) ?? null);
      } catch {
        entries = [];
      }
    }
    return entries;
  };

  const commit = (next: AddressBookEntry[]): void => {
    entries = next.slice(0, MAX_ENTRIES);
    index = null;
    version++;
    try {
      storage()?.setItem(BOOK_STORAGE_KEY, serializeBook(entries));
    } catch {
      // Private mode or quota: the book lasts for this page only.
    }
    for (const listener of [...listeners]) listener();
  };

  return {
    entries: read,
    index() {
      if (index === null) index = buildBookIndex(read());
      return index;
    },
    add(input) {
      const candidate = sanitizeEntry({ ...input, addedAt: Date.now(), id: newId() });
      if (!candidate) return null;
      const current = read();
      const same = findSame(current, candidate.address, candidate.cred);
      if (same) {
        // The same address twice is a relabel, not a second entry.
        const merged: AddressBookEntry = {
          ...same,
          label: candidate.label,
          note: candidate.note ?? same.note,
          cred: candidate.cred ?? same.cred,
          credType: candidate.credType ?? same.credType,
        };
        commit(current.map((entry) => (entry.id === same.id ? merged : entry)));
        return merged;
      }
      if (current.length >= MAX_ENTRIES) return null;
      commit([candidate, ...current]);
      return candidate;
    },
    update(id, patch) {
      const current = read();
      const held = current.find((entry) => entry.id === id);
      if (!held) return;
      const label = patch.label === undefined ? held.label : sanitizeText(patch.label, MAX_LABEL);
      if (!label) return;
      const note =
        patch.note === undefined ? held.note : (sanitizeText(patch.note, MAX_NOTE) ?? undefined);
      commit(current.map((entry) => (entry.id === id ? { ...entry, label, note } : entry)));
    },
    remove(id) {
      const current = read();
      const next = current.filter((entry) => entry.id !== id);
      if (next.length !== current.length) commit(next);
    },
    importJson(text, mode) {
      const incoming = parseBook(text);
      const report: ImportReport = { added: 0, updated: 0, skipped: 0 };
      let working = mode === "replace" ? [] : [...read()];
      for (const entry of incoming) {
        const same = findSame(working, entry.address, entry.cred);
        if (same) {
          working = working.map((held) =>
            held.id === same.id ? { ...held, label: entry.label, note: entry.note ?? held.note } : held,
          );
          report.updated++;
        } else if (working.length < MAX_ENTRIES) {
          working.push(entry);
          report.added++;
        } else {
          report.skipped++;
        }
      }
      // Rows the reader dropped count as skipped, so a bad file is visible.
      try {
        const document = JSON.parse(text) as unknown;
        const rowCount = Array.isArray(document)
          ? document.length
          : Array.isArray((document as { entries?: unknown[] })?.entries)
            ? (document as { entries: unknown[] }).entries.length
            : 0;
        report.skipped += Math.max(0, rowCount - incoming.length);
      } catch {
        report.skipped += 1;
      }
      commit(working);
      return report;
    },
    exportJson() {
      return serializeBook(read());
    },
    clear() {
      commit([]);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version() {
      // Reading the book on first use keeps the first render and the first
      // subscription in step: both see the stored list, not an empty one.
      read();
      return version;
    },
  };
}

/** The app's book, shared by every view. */
export const addressBookStore: AddressBookStore = createAddressBookStore();
