"use client";

// The address book itself: what is saved, what the registry adds, and the two
// settings that decide where the registry data comes from.

import { useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { PencilIcon, PlusIcon, RefreshIcon, TrashIcon } from "../Icons";
import { AddressEntryDialog } from "./AddressEntryDialog";
import { useAddressBookEntries, useRegistry } from "@/lib/useAddressBook";
import { primeAddresses, readDecodedAddress } from "@/lib/decodedAddresses";
import { describeRegistryAge, describeRegistrySource } from "@/utils/addressbook/describe";
import { REGISTRY_REPO, registryStore } from "@/utils/addressbook/registry";
import { addressBookStore, MAX_ENTRIES } from "@/utils/addressbook/store";
import type { AddressBookEntry } from "@/utils/addressbook/types";

const ADDRESS_SHAPE = /^(addr|stake)(_test)?1[02-9ac-hj-np-z]{10,}$/;
const CRED_SHAPE = /^[0-9a-f]{56}$/;

function shorten(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 12)}…${value.slice(-10)}`;
}

function matchesQuery(entry: AddressBookEntry, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    entry.label.toLowerCase().includes(needle) ||
    (entry.note?.toLowerCase().includes(needle) ?? false) ||
    (entry.address?.includes(needle) ?? false) ||
    (entry.cred?.includes(needle) ?? false)
  );
}

export function AddressBookPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const entries = useAddressBookEntries();
  // Opening the panel is a reason to load the registry: the status line below
  // reports what is in use.
  const registry = useRegistry();
  const [query, setQuery] = useState("");
  const [draftAddress, setDraftAddress] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [editing, setEditing] = useState<AddressBookEntry | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(
    () => entries.filter((entry) => matchesQuery(entry, query)),
    [entries, query],
  );

  const addDraft = async (): Promise<void> => {
    const text = draftAddress.trim().toLowerCase();
    const label = draftLabel.trim();
    if (!label) {
      setAddError("Give the entry a label.");
      return;
    }
    if (ADDRESS_SHAPE.test(text)) {
      // The payment credential comes from the decoder, so a contract address
      // saved here matches every address that shares its payment script.
      await primeAddresses([text]);
      const payment = readDecodedAddress(text)?.details.payment_cred;
      const saved = addressBookStore.add({
        label,
        address: text,
        cred: payment?.type === "ScriptHash" ? payment.credential.toLowerCase() : undefined,
        credType: payment?.type,
      });
      if (!saved) {
        setAddError("The address could not be saved.");
        return;
      }
    } else if (CRED_SHAPE.test(text)) {
      const saved = addressBookStore.add({ label, cred: text, credType: "ScriptHash" });
      if (!saved) {
        setAddError("The credential could not be saved.");
        return;
      }
    } else {
      setAddError("Enter a bech32 address or a 56-character script hash.");
      return;
    }
    setDraftAddress("");
    setDraftLabel("");
    setAddError(null);
  };

  const exportBook = (): void => {
    try {
      const blob = new Blob([addressBookStore.exportJson()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "cquisitor-addressbook.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setReport("The file could not be written.");
    }
  };

  const importBook = async (file: File | null | undefined): Promise<void> => {
    if (!file) return;
    try {
      const text = await file.text();
      const result = addressBookStore.importJson(text, "merge");
      setReport(
        `Imported: ${result.added} added, ${result.updated} relabelled, ${result.skipped} skipped.`,
      );
    } catch {
      setReport("The file could not be read.");
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="cq-ab-dialog-overlay" />
        <Dialog.Content className="cq-ab-panel" aria-describedby={undefined}>
          <Dialog.Title className="cq-ab-dialog-title">Address book</Dialog.Title>
          <p className="cq-ab-panel-intro">
            An address you name here carries a green check and that name wherever a transaction
            shows it. An address that only starts or ends like one of them is flagged instead. The
            book stays in this browser.
          </p>

          <div className="cq-ab-panel-body">
            <section className="cq-ab-panel-section">
              <h4 className="cq-ab-panel-heading">Add an address</h4>
              <div className="cq-ab-add-row">
                <input
                  className="cq-ab-input cq-ab-input-grow"
                  placeholder="addr1… , stake1… , or a 56-character script hash"
                  value={draftAddress}
                  spellCheck={false}
                  onChange={(e) => {
                    setDraftAddress(e.target.value);
                    setAddError(null);
                  }}
                />
                <input
                  className="cq-ab-input"
                  placeholder="label"
                  value={draftLabel}
                  spellCheck={false}
                  onChange={(e) => {
                    setDraftLabel(e.target.value);
                    setAddError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addDraft();
                  }}
                />
                <button
                  type="button"
                  className="cq-ab-button cq-ab-button-primary"
                  onClick={() => void addDraft()}
                  disabled={!draftAddress.trim() || !draftLabel.trim()}
                >
                  <PlusIcon size={11} /> Add
                </button>
              </div>
              {addError && <div className="cq-ab-error">{addError}</div>}
            </section>

            <section className="cq-ab-panel-section">
              <div className="cq-ab-panel-heading-row">
                <h4 className="cq-ab-panel-heading">
                  Saved addresses ({entries.length}/{MAX_ENTRIES})
                </h4>
                {entries.length > 0 && (
                  <input
                    className="cq-ab-input cq-ab-input-search"
                    placeholder="search"
                    value={query}
                    spellCheck={false}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                )}
              </div>
              {entries.length === 0 && (
                <div className="cq-ab-empty">
                  Nothing saved yet. Use the + beside any address in a transaction, or the field
                  above.
                </div>
              )}
              {entries.length > 0 && shown.length === 0 && (
                <div className="cq-ab-empty">No entry matches “{query}”.</div>
              )}
              {shown.length > 0 && (
                <ul className="cq-ab-list">
                  {shown.map((entry) => (
                    <li key={entry.id} className="cq-ab-list-row">
                      <div className="cq-ab-list-main">
                        <span className="cq-ab-list-label">{entry.label}</span>
                        {entry.note && <span className="cq-ab-list-note">{entry.note}</span>}
                        <code className="cq-ab-list-mono" title={entry.address ?? entry.cred}>
                          {entry.address ? shorten(entry.address) : shorten(entry.cred ?? "")}
                        </code>
                        <span className="cq-ab-list-kind">
                          {entry.address
                            ? entry.cred
                              ? "address + payment credential"
                              : "address only"
                            : "payment credential"}
                        </span>
                      </div>
                      <div className="cq-ab-list-actions">
                        <button
                          type="button"
                          className="cq-ab-icon-button"
                          aria-label={`Edit ${entry.label}`}
                          onClick={() => setEditing(entry)}
                        >
                          <PencilIcon size={12} />
                        </button>
                        <button
                          type="button"
                          className="cq-ab-icon-button cq-ab-icon-danger"
                          aria-label={`Delete ${entry.label}`}
                          onClick={() => addressBookStore.remove(entry.id)}
                        >
                          <TrashIcon size={12} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="cq-ab-file-row">
                <button type="button" className="cq-ab-button" onClick={exportBook}>
                  Export JSON
                </button>
                <button
                  type="button"
                  className="cq-ab-button"
                  onClick={() => fileRef.current?.click()}
                >
                  Import JSON
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="cq-ab-file-input"
                  onChange={(e) => {
                    void importBook(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {report && <span className="cq-ab-file-report">{report}</span>}
              </div>
            </section>

            <section className="cq-ab-panel-section">
              <h4 className="cq-ab-panel-heading">eternl registry</h4>
              <p className="cq-ab-panel-note">
                A community list of Cardano contract scripts. It names the contract behind an
                address before you have saved anything. A registry name is never a green check: it
                is a third-party claim, and the badge says so.
              </p>
              <label className="cq-ab-check">
                <input
                  type="checkbox"
                  checked={registry.live}
                  onChange={(e) => registryStore.setLive(e.target.checked)}
                />
                <span>
                  Refresh it over the network
                  <span className="cq-ab-check-hint">
                    Off: only the snapshot that ships with the app is used, and no request leaves
                    the browser. On: the index is fetched from raw.githubusercontent.com once a day,
                    so a contract classified after the last release is still named. A reply that
                    does not parse is dropped and the snapshot stands.
                  </span>
                </span>
              </label>
              <div className="cq-ab-registry-status">
                <span>{describeRegistrySource(registry)}</span>
                {describeRegistryAge(registry) && <span>{describeRegistryAge(registry)}</span>}
                {registry.error && (
                  <span className="cq-ab-error">
                    The last refresh gave nothing ({registry.error}). The snapshot is in use.
                  </span>
                )}
                <a
                  className="cq-ab-tooltip-link"
                  href={REGISTRY_REPO}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {REGISTRY_REPO}
                </a>
              </div>
              <button
                type="button"
                className="cq-ab-button"
                onClick={() => void registryStore.refresh()}
                disabled={registry.refreshing}
              >
                <RefreshIcon size={11} /> {registry.refreshing ? "Checking…" : "Check now"}
              </button>
            </section>
          </div>

          <div className="cq-ab-dialog-actions">
            <span className="cq-ab-dialog-spacer" />
            <Dialog.Close asChild>
              <button type="button" className="cq-ab-button cq-ab-button-primary">
                Done
              </button>
            </Dialog.Close>
          </div>
          <AddressEntryDialog
            open={editing !== null}
            onOpenChange={(next) => setEditing(next ? editing : null)}
            entry={editing}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default AddressBookPanel;
