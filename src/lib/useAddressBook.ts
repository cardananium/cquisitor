"use client";

// React reads of the address book and of the eternl registry.
//
// Both stores are plain modules, so any card can ask about an address without
// a provider around it. The lookup also needs the payment credential, which
// the decoded-address store answers synchronously once a decode has landed;
// asking for a miss is what makes an early call correct rather than quiet, as
// the decode then bumps that store's version and this memo runs again.

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { readDecodedAddress, requestAddress } from "./decodedAddresses";
import { useDecodedAddressVersion } from "./useDecodedAddress";
import { matchAddress } from "@/utils/addressbook/lookup";
import { registryStore, type RegistryState } from "@/utils/addressbook/registry";
import { addressBookStore } from "@/utils/addressbook/store";
import { emptyBundle } from "@/utils/addressbook/registryData";
import type { AddressBookEntry, AddressMatch, CredentialType } from "@/utils/addressbook/types";

/** Book version. List it in memos that read the book, or a change never reaches them. */
export function useAddressBookVersion(): number {
  return useSyncExternalStore(
    addressBookStore.subscribe,
    addressBookStore.version,
    // The server has no storage; 0 matches the first client render.
    () => 0,
  );
}

export function useAddressBookEntries(): readonly AddressBookEntry[] {
  useAddressBookVersion();
  return addressBookStore.entries();
}

/** One state object per change, so it can be a memo dependency as it is. */
const SERVER_REGISTRY_STATE: RegistryState = {
  status: "idle",
  bundle: emptyBundle(),
  index: null,
  live: true,
  fetchedAt: null,
  refreshing: false,
  error: null,
};

export function useRegistryState(): RegistryState {
  return useSyncExternalStore(
    registryStore.subscribe,
    registryStore.state,
    () => SERVER_REGISTRY_STATE,
  );
}

/** Starts the registry load on the first view that needs it, and only then. */
export function useRegistry(): RegistryState {
  const state = useRegistryState();
  useEffect(() => {
    registryStore.ensure();
  }, []);
  return state;
}

export interface AddressCredentials {
  cred: string | null;
  credType: CredentialType | null;
  stakeCred: string | null;
}

/** The credentials of an address, as far as the decode has got. */
export function useAddressCredentials(address: string | null | undefined): AddressCredentials {
  const version = useDecodedAddressVersion();
  return useMemo(() => {
    // The store version is what re-runs this memo once a decode lands.
    void version;
    if (!address) return { cred: null, credType: null, stakeCred: null };
    const decoded = readDecodedAddress(address);
    if (decoded === undefined) {
      if (typeof window !== "undefined") requestAddress(address);
      return { cred: null, credType: null, stakeCred: null };
    }
    const payment = decoded?.details.payment_cred;
    const stake = decoded?.details.staking_cred;
    return {
      cred: payment?.credential.toLowerCase() ?? null,
      credType: payment?.type ?? null,
      stakeCred: stake?.credential.toLowerCase() ?? null,
    };
  }, [address, version]);
}

/** What to show beside `address`: the book's answer, the registry's, or a warning. */
export function useAddressMatch(address: string | null | undefined): AddressMatch | null {
  const bookVersion = useAddressBookVersion();
  const registry = useRegistry();
  const { cred, stakeCred } = useAddressCredentials(address);
  return useMemo(() => {
    // The book version is what re-runs this memo when an entry changes.
    void bookVersion;
    if (!address) return null;
    return matchAddress(address, cred, addressBookStore.index(), registry.index, stakeCred);
  }, [address, cred, stakeCred, registry.index, bookVersion]);
}
