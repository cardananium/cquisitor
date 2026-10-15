"use client";

// Saving one address under a name, and editing what was saved.
//
// The form is its own component, mounted with the dialog and keyed by what it
// edits, so each opening starts from the entry in front of it. That is why no
// effect copies props into state here.

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { addressBookStore, MAX_LABEL, MAX_NOTE } from "@/utils/addressbook/store";
import type { AddressBookEntry, CredentialType } from "@/utils/addressbook/types";

interface AddressEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The address the dialog opened from. Absent when a credential is saved on its own. */
  address?: string;
  /** Payment credential of that address, when the decode has landed. */
  cred?: string | null;
  credType?: CredentialType | null;
  /** The entry being edited. Absent when a new one is saved. */
  entry?: AddressBookEntry | null;
  /** What the label starts as, e.g. the name the registry gives the script. */
  suggestedLabel?: string;
}

function shortCred(cred: string): string {
  return `${cred.slice(0, 8)}…${cred.slice(-8)}`;
}

type FormProps = Omit<AddressEntryDialogProps, "open" | "onOpenChange"> & {
  close: () => void;
};

function EntryForm({ address, cred, credType, entry, suggestedLabel, close }: FormProps) {
  const editing = !!entry;
  const [label, setLabel] = useState(entry?.label ?? suggestedLabel ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  // A contract reaches the chain under many addresses that share one payment
  // script, so a script credential matches by default. A key credential does
  // not: another address holding it is a different address, and only the one
  // the viewer saved should carry their name.
  const [matchCred, setMatchCred] = useState(
    entry ? !!entry.cred : credType === "ScriptHash",
  );

  const shownAddress = address ?? entry?.address;
  const shownCred = cred ?? entry?.cred ?? null;

  const save = (): void => {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (entry) {
      addressBookStore.update(entry.id, { label: trimmed, note: note.trim() });
    } else {
      addressBookStore.add({
        label: trimmed,
        note: note.trim() || undefined,
        address,
        cred: matchCred ? (cred ?? undefined) : undefined,
        credType: matchCred ? (credType ?? undefined) : undefined,
      });
    }
    close();
  };

  return (
    <>
      <Dialog.Title className="cq-ab-dialog-title">
        {editing ? "Edit address book entry" : "Add to address book"}
      </Dialog.Title>
      <div className="cq-ab-dialog-body">
        {shownAddress && (
          <div className="cq-ab-field">
            <span className="cq-ab-field-label">Address</span>
            <code className="cq-ab-mono-block">{shownAddress}</code>
          </div>
        )}
        {!shownAddress && shownCred && (
          <div className="cq-ab-field">
            <span className="cq-ab-field-label">Credential</span>
            <code className="cq-ab-mono-block">{shownCred}</code>
          </div>
        )}
        <label className="cq-ab-field">
          <span className="cq-ab-field-label">Label</span>
          <input
            className="cq-ab-input"
            value={label}
            maxLength={MAX_LABEL}
            autoFocus
            spellCheck={false}
            placeholder="e.g. my cold wallet"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
          />
        </label>
        <label className="cq-ab-field">
          <span className="cq-ab-field-label">Note (optional)</span>
          <input
            className="cq-ab-input"
            value={note}
            maxLength={MAX_NOTE}
            spellCheck={false}
            placeholder="why this address matters"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
          />
        </label>
        {!editing && shownCred && (
          <label className="cq-ab-check">
            <input
              type="checkbox"
              checked={matchCred}
              onChange={(e) => setMatchCred(e.target.checked)}
            />
            <span>
              Also match every address with payment credential <code>{shortCred(shownCred)}</code>
              <span className="cq-ab-check-hint">
                {credType === "ScriptHash"
                  ? "A contract keeps one payment script and varies the delegation part, so this is how a contract is recognised."
                  : "Another address can hold this key with a different delegation part. Leave it off to name only the address above."}
              </span>
            </span>
          </label>
        )}
        {editing && (
          <div className="cq-ab-dialog-meta">
            {entry?.cred
              ? `Matches the saved address and every address with payment credential ${shortCred(entry.cred)}.`
              : "Matches the saved address only."}
          </div>
        )}
      </div>
      <div className="cq-ab-dialog-actions">
        {editing && entry && (
          <button
            type="button"
            className="cq-ab-button cq-ab-button-danger"
            onClick={() => {
              addressBookStore.remove(entry.id);
              close();
            }}
          >
            Delete
          </button>
        )}
        <span className="cq-ab-dialog-spacer" />
        <Dialog.Close asChild>
          <button type="button" className="cq-ab-button">
            Cancel
          </button>
        </Dialog.Close>
        <button
          type="button"
          className="cq-ab-button cq-ab-button-primary"
          onClick={save}
          disabled={!label.trim()}
        >
          {editing ? "Save" : "Add"}
        </button>
      </div>
    </>
  );
}

export function AddressEntryDialog({ open, onOpenChange, ...rest }: AddressEntryDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="cq-ab-dialog-overlay" />
        <Dialog.Content className="cq-ab-dialog" aria-describedby={undefined}>
          <EntryForm
            key={rest.entry?.id ?? rest.address ?? "new"}
            {...rest}
            close={() => onOpenChange(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default AddressEntryDialog;
