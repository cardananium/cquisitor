// The address book model: what the viewer saved, what the eternl registry
// reports, and what one lookup against both of them says about an address.

export type CredentialType = "KeyHash" | "ScriptHash";

/**
 * One saved address.
 *
 * `address` holds the bech32 string the viewer saved. `cred` holds the payment
 * credential of that address, which is the key every contract matches on: a
 * protocol bakes a varying stake credential into its order address, so one
 * contract appears under many bech32 strings that all share one payment
 * credential. A reward address carries one credential, and the decoder reports
 * it as the payment credential, so `cred` covers that case too.
 *
 * An entry made from a bare script hash has no `address`.
 */
export interface AddressBookEntry {
  id: string;
  label: string;
  note?: string;
  /** Bech32 address, lowercased. */
  address?: string;
  /** Payment credential, lowercase hex. */
  cred?: string;
  credType?: CredentialType;
  /** Epoch milliseconds of the save. */
  addedAt: number;
}

/** A project of the eternl registry. */
export interface RegistryProject {
  id: string;
  label: string;
  category?: string;
  subCategory?: string;
  link?: string;
}

/** One script of the eternl registry. */
export interface RegistryScript {
  /** Payment script hash, lowercase hex, 56 characters. */
  hash: string;
  /**
   * Stake credential hash, when the registry names one address rather than a
   * credential. An address matches such an entry on both parts; it still
   * matches on the payment hash alone, because that script governs spending.
   */
  stakeHash?: string;
  projectId: string;
  name: string;
  /** Upstream purpose, e.g. `SPEND`, `MINT`, `SPEND/MINT`. */
  purpose?: string;
}

/** Where a loaded registry came from. */
export type RegistrySource = "snapshot" | "network";

export interface RegistryBundle {
  projects: Map<string, RegistryProject>;
  scripts: Map<string, RegistryScript>;
  /** The `metadata.generatedAt` upstream reported, when it reported one. */
  generatedAt: string | null;
  source: RegistrySource;
  /** Epoch milliseconds of the fetch. Only a network bundle has one. */
  fetchedAt?: number;
}

/** The address is in the book. */
export interface KnownMatch {
  kind: "known";
  entry: AddressBookEntry;
  /** `address`: the saved string. `cred`: the saved payment credential, under another address. */
  via: "address" | "cred";
}

/** The payment credential of the address is a script the registry names. */
export interface RegistryMatch {
  kind: "registry";
  script: RegistryScript;
  project: RegistryProject | null;
  source: RegistrySource;
  /**
   * `pair`: the payment and the stake credential both agree with the entry.
   * `payment`: the payment script agrees and the delegation part does not.
   */
  via: "pair" | "payment";
}

/** What a lookalike was measured against. */
export interface LookalikeTarget {
  label: string;
  /** The compared string: a bech32 address, or a credential in hex. */
  text: string;
  origin: "book" | "registry";
  /** A second line for the card, e.g. the registry script name. */
  detail?: string;
}

/** Characters two strings share at each end. Counted on the compared strings. */
export interface MatchRun {
  prefix: number;
  suffix: number;
}

/** The address is not known, but it starts or ends like something that is. */
export interface LookalikeMatch {
  kind: "lookalike";
  target: LookalikeTarget;
  run: MatchRun;
  /** Which string pair is alike: the bech32 addresses, or the hex credentials. */
  field: "address" | "cred";
  /** The viewer's own string for the compared field, so the card can show both. */
  text: string;
}

export type AddressMatch = KnownMatch | RegistryMatch | LookalikeMatch;
