"use client";

// The header entry point to the address book. The count tells the viewer how
// many addresses carry their own name, without opening the panel.

import { useState } from "react";
import { AddressBookIcon } from "../Icons";
import { AddressBookPanel } from "./AddressBookPanel";
import { useAddressBookEntries } from "@/lib/useAddressBook";

export function AddressBookButton() {
  const entries = useAddressBookEntries();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="cq-ab-header-button"
        onClick={() => setOpen(true)}
        title="Address book: name the addresses you trust"
      >
        <AddressBookIcon size={14} />
        <span>Addresses</span>
        {entries.length > 0 && <span className="cq-ab-header-count">{entries.length}</span>}
      </button>
      <AddressBookPanel open={open} onOpenChange={setOpen} />
    </>
  );
}

export default AddressBookButton;
