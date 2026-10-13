// What one address gets told about itself: an exact answer from the book, a
// name from the eternl registry, or a warning that it only looks like one of
// those. The indexes make every lookup a map read plus a confirmation on the
// few candidates a bucket holds, so a card can call this during a render.

import {
  addressLookalike,
  addressPrefixKey,
  addressSuffixKey,
  hexLookalike,
  hexPrefixKey,
  hexSuffixKey,
  runScore,
} from "./similarity";
import type {
  AddressBookEntry,
  AddressMatch,
  LookalikeMatch,
  MatchRun,
  RegistryBundle,
  RegistryScript,
} from "./types";

export interface BookIndex {
  entries: readonly AddressBookEntry[];
  byAddress: Map<string, AddressBookEntry>;
  byCred: Map<string, AddressBookEntry>;
  addressPrefix: Map<string, AddressBookEntry[]>;
  addressSuffix: Map<string, AddressBookEntry[]>;
  credPrefix: Map<string, AddressBookEntry[]>;
  credSuffix: Map<string, AddressBookEntry[]>;
}

export interface RegistryIndex {
  bundle: RegistryBundle;
  /** Payment hash to the first script with it, ignoring any stake part. */
  byPayment: Map<string, RegistryScript>;
  hashPrefix: Map<string, RegistryScript[]>;
  hashSuffix: Map<string, RegistryScript[]>;
}

function push<T>(map: Map<string, T[]>, key: string | null, value: T): void {
  if (key === null) return;
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

export function buildBookIndex(entries: readonly AddressBookEntry[]): BookIndex {
  const index: BookIndex = {
    entries,
    byAddress: new Map(),
    byCred: new Map(),
    addressPrefix: new Map(),
    addressSuffix: new Map(),
    credPrefix: new Map(),
    credSuffix: new Map(),
  };
  for (const entry of entries) {
    if (entry.address) {
      // First save wins, so a later duplicate cannot take over the label.
      if (!index.byAddress.has(entry.address)) index.byAddress.set(entry.address, entry);
      push(index.addressPrefix, addressPrefixKey(entry.address), entry);
      push(index.addressSuffix, addressSuffixKey(entry.address), entry);
    }
    if (entry.cred) {
      if (!index.byCred.has(entry.cred)) index.byCred.set(entry.cred, entry);
      push(index.credPrefix, hexPrefixKey(entry.cred), entry);
      push(index.credSuffix, hexSuffixKey(entry.cred), entry);
    }
  }
  return index;
}

export function buildRegistryIndex(bundle: RegistryBundle): RegistryIndex {
  const index: RegistryIndex = {
    bundle,
    byPayment: new Map(),
    hashPrefix: new Map(),
    hashSuffix: new Map(),
  };
  for (const script of bundle.scripts.values()) {
    // An entry without a stake part is the general one, so it wins the slot.
    const held = index.byPayment.get(script.hash);
    if (!held || (held.stakeHash && !script.stakeHash)) index.byPayment.set(script.hash, script);
    push(index.hashPrefix, hexPrefixKey(script.hash), script);
    push(index.hashSuffix, hexSuffixKey(script.hash), script);
  }
  return index;
}

interface Candidate {
  match: LookalikeMatch;
  score: number;
}

function better(current: Candidate | null, next: Candidate | null): Candidate | null {
  if (!next) return current;
  if (!current) return next;
  if (next.score > current.score) return next;
  // A tie goes to the book: the viewer's own label is the stronger warning.
  if (next.score === current.score && next.match.target.origin === "book") {
    return current.match.target.origin === "book" ? current : next;
  }
  return current;
}

function bookCandidate(
  run: MatchRun | null,
  entry: AddressBookEntry,
  field: "address" | "cred",
  mine: string,
  theirs: string,
): Candidate | null {
  if (!run) return null;
  return {
    score: runScore(run, theirs, field),
    match: {
      kind: "lookalike",
      field,
      text: mine,
      run,
      target: {
        label: entry.label,
        text: theirs,
        origin: "book",
        detail: field === "cred" ? "saved payment credential" : undefined,
      },
    },
  };
}

function registryCandidate(
  run: MatchRun | null,
  script: RegistryScript,
  registry: RegistryIndex,
  mine: string,
): Candidate | null {
  if (!run) return null;
  const project = registry.bundle.projects.get(script.projectId) ?? null;
  return {
    score: runScore(run, script.hash, "cred"),
    match: {
      kind: "lookalike",
      field: "cred",
      text: mine,
      run,
      target: {
        label: project?.label ?? script.projectId,
        text: script.hash,
        origin: "registry",
        detail: script.name,
      },
    },
  };
}

/**
 * Candidates for one bucket pair, confirmed by the full comparison. A bucket
 * hit only means the key agrees; `addressLookalike` and `hexLookalike` decide.
 */
function scanBuckets<T>(
  buckets: Array<T[] | undefined>,
  seen: Set<T>,
  visit: (item: T) => Candidate | null,
): Candidate | null {
  let best: Candidate | null = null;
  for (const bucket of buckets) {
    if (!bucket) continue;
    for (const item of bucket) {
      if (seen.has(item)) continue;
      seen.add(item);
      best = better(best, visit(item));
    }
  }
  return best;
}

/**
 * What to show beside `address`.
 *
 * The order is the trust order, and the first answer wins:
 *   1. the exact address the viewer saved;
 *   2. an address with a payment credential the viewer saved;
 *   3. a script the registry names;
 *   4. a string that only starts or ends like one of those.
 * `cred` is the payment credential of the address in lowercase hex, and
 * `stakeCred` the delegation one, both null while the decode has not landed
 * yet. Without `cred` only steps 1 and 4 can answer, and a later call with the
 * credential gives the full answer.
 */
export function matchAddress(
  address: string,
  cred: string | null,
  book: BookIndex | null,
  registry: RegistryIndex | null,
  stakeCred?: string | null,
): AddressMatch | null {
  const subject = address.toLowerCase();
  if (book) {
    const exact = book.byAddress.get(subject);
    if (exact) return { kind: "known", entry: exact, via: "address" };
    if (cred) {
      const byCred = book.byCred.get(cred);
      if (byCred) return { kind: "known", entry: byCred, via: "cred" };
    }
  }
  if (registry && cred) {
    const pair = stakeCred ? registry.bundle.scripts.get(cred + stakeCred) : undefined;
    const script = pair ?? registry.byPayment.get(cred);
    if (script) {
      return {
        kind: "registry",
        script,
        project: registry.bundle.projects.get(script.projectId) ?? null,
        source: registry.bundle.source,
        via: pair ? "pair" : "payment",
      };
    }
  }

  let best: Candidate | null = null;
  if (book) {
    const seenEntries = new Set<AddressBookEntry>();
    best = better(
      best,
      scanBuckets(
        [
          book.addressPrefix.get(addressPrefixKey(subject) ?? ""),
          book.addressSuffix.get(addressSuffixKey(subject) ?? ""),
        ],
        seenEntries,
        (entry) =>
          entry.address
            ? bookCandidate(
                addressLookalike(subject, entry.address),
                entry,
                "address",
                subject,
                entry.address,
              )
            : null,
      ),
    );
    if (cred) {
      const seenCreds = new Set<AddressBookEntry>();
      best = better(
        best,
        scanBuckets(
          [book.credPrefix.get(hexPrefixKey(cred) ?? ""), book.credSuffix.get(hexSuffixKey(cred) ?? "")],
          seenCreds,
          (entry) =>
            entry.cred
              ? bookCandidate(hexLookalike(cred, entry.cred), entry, "cred", cred, entry.cred)
              : null,
        ),
      );
    }
  }
  if (registry && cred) {
    const seenScripts = new Set<RegistryScript>();
    best = better(
      best,
      scanBuckets(
        [
          registry.hashPrefix.get(hexPrefixKey(cred) ?? ""),
          registry.hashSuffix.get(hexSuffixKey(cred) ?? ""),
        ],
        seenScripts,
        (script) => registryCandidate(hexLookalike(cred, script.hash), script, registry, cred),
      ),
    );
  }
  return best?.match ?? null;
}

/** The registry's name for a script hash, for a hash the view shows on its own. */
export function matchScriptHash(
  hash: string,
  registry: RegistryIndex | null,
): RegistryScript | null {
  if (!registry) return null;
  return registry.byPayment.get(hash.toLowerCase()) ?? null;
}
