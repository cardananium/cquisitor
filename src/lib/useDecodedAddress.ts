"use client";

// Synchronous React reads of the decoded-address store; subscribe so late answers re-render.

import { useSyncExternalStore } from "react";
import type { DecodedAddress } from "@/utils/addressTypes";
import {
  decodedAddressesVersion,
  readDecodedAddress,
  requestAddress,
  subscribeDecodedAddresses,
} from "./decodedAddresses";

/** Store version. List this in memos that decode addresses, or a late result never reaches them. */
export function useDecodedAddressVersion(): number {
  return useSyncExternalStore(
    subscribeDecodedAddresses,
    decodedAddressesVersion,
    // SSR has no store; 0 matches the first client render before anything is decoded.
    () => 0,
  );
}

/** Decode of `address`, or `null` if unknown or not an address. Requests a decode if missing. */
export function useDecodedAddress(address: string | null | undefined): DecodedAddress | null {
  // Subscribe before reading so a later decode re-renders this component.
  useDecodedAddressVersion();
  if (!address) return null;
  const known = readDecodedAddress(address);
  if (known !== undefined) return known;
  if (typeof window !== "undefined") requestAddress(address);
  return null;
}
