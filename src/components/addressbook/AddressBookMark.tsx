"use client";

// What sits beside an address: the book's green check, the registry's name, or
// a warning that the string only looks like something known. The three states
// are kept apart on purpose. The check says the viewer saved this address. The
// registry badge says a third-party list names the script behind it, which is
// a weaker claim, and the badge says so.

import { useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { AlertTriangleIcon, CheckIcon, PlusIcon, TagIcon } from "../Icons";
import { AddressEntryDialog } from "./AddressEntryDialog";
import { useAddressCredentials } from "@/lib/useAddressBook";
import { REGISTRY_REPO } from "@/utils/addressbook/registry";
import type { AddressMatch, MatchRun } from "@/utils/addressbook/types";

/** The class the row carries, so a warning colours more than the badge. */
export function matchRowClass(match: AddressMatch | null): string {
  if (!match) return "";
  if (match.kind === "known") return "cq-ab-row-known";
  if (match.kind === "registry") return "cq-ab-row-registry";
  return "cq-ab-row-lookalike";
}

function formatWhen(at: number | null | undefined): string {
  if (!at) return "";
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/** A string with the characters it shares with another one marked. */
function RunText({ text, run }: { text: string; run: MatchRun }) {
  const head = text.slice(0, run.prefix);
  const tail = run.suffix > 0 ? text.slice(text.length - run.suffix) : "";
  const middle = text.slice(run.prefix, text.length - run.suffix);
  return (
    <code className="cq-ab-run">
      {head && <span className="cq-ab-run-match">{head}</span>}
      {middle}
      {tail && <span className="cq-ab-run-match">{tail}</span>}
    </code>
  );
}

function runSentence(run: MatchRun): string {
  const parts: string[] = [];
  if (run.prefix > 0) parts.push(`the first ${run.prefix} characters`);
  if (run.suffix > 0) parts.push(`the last ${run.suffix} characters`);
  if (parts.length === 0) return "";
  return `${parts.join(" and ")} agree`;
}

interface BadgeProps {
  match: AddressMatch;
  registryNote: string;
  onEdit: () => void;
}

function MatchBadge({ match, registryNote, onEdit }: BadgeProps) {
  if (match.kind === "known") {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            className="cq-ab-badge cq-ab-badge-known"
            onClick={(e) => {
              // The row around an address can be clickable; editing a label is
              // not a click on it.
              e.stopPropagation();
              e.preventDefault();
              onEdit();
            }}
          >
            <CheckIcon size={11} />
            <span className="cq-ab-badge-text">{match.entry.label}</span>
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="cq-ab-tooltip" sideOffset={6} side="top" align="start">
            <div className="cq-ab-tooltip-head cq-ab-tooltip-head-known">In your address book</div>
            <div className="cq-ab-tooltip-body">
              <div className="cq-ab-tooltip-label">{match.entry.label}</div>
              {match.entry.note && <div className="cq-ab-tooltip-note">{match.entry.note}</div>}
              <div className="cq-ab-tooltip-line">
                {match.via === "address"
                  ? "The address matches the one you saved."
                  : "The payment credential matches the one you saved; the delegation part differs from that address."}
              </div>
              {match.entry.addedAt > 0 && (
                <div className="cq-ab-tooltip-line">Saved {formatWhen(match.entry.addedAt)}</div>
              )}
              <div className="cq-ab-tooltip-hint">Click the badge to edit or delete it.</div>
            </div>
            <Tooltip.Arrow className="cq-ab-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  }

  if (match.kind === "registry") {
    const project = match.project?.label ?? match.script.projectId;
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="cq-ab-badge cq-ab-badge-registry">
            <TagIcon size={11} />
            <span className="cq-ab-badge-text">
              {project}
              <span className="cq-ab-badge-sub"> · {match.script.name}</span>
            </span>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="cq-ab-tooltip" sideOffset={6} side="top" align="start">
            <div className="cq-ab-tooltip-head cq-ab-tooltip-head-registry">
              Named by the eternl registry
            </div>
            <div className="cq-ab-tooltip-body">
              <div className="cq-ab-tooltip-label">{project}</div>
              <div className="cq-ab-tooltip-line">{match.script.name}</div>
              {match.script.purpose && (
                <div className="cq-ab-tooltip-line">Purpose: {match.script.purpose}</div>
              )}
              {match.project?.subCategory && match.project.subCategory !== "UNKNOWN" && (
                <div className="cq-ab-tooltip-line">
                  {match.project.category} · {match.project.subCategory}
                </div>
              )}
              <div className="cq-ab-tooltip-line">
                {match.via === "pair"
                  ? "The payment script and the delegation part both match the registry entry."
                  : "The payment script matches the registry entry."}
              </div>
              <div className="cq-ab-tooltip-warn">
                A third-party list says this, not you. Add the address to your book to get a green
                check.
              </div>
              <div className="cq-ab-tooltip-line">{registryNote}</div>
              {match.project?.link && (
                <a
                  className="cq-ab-tooltip-link"
                  href={match.project.link}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {match.project.link}
                </a>
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
            <Tooltip.Arrow className="cq-ab-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  }

  const field = match.field === "address" ? "address" : "payment credential";
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className="cq-ab-badge cq-ab-badge-lookalike">
          <AlertTriangleIcon size={11} />
          <span className="cq-ab-badge-text">looks like “{match.target.label}”</span>
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="cq-ab-tooltip" sideOffset={6} side="top" align="start">
          <div className="cq-ab-tooltip-head cq-ab-tooltip-head-lookalike">
            This is not a known address
          </div>
          <div className="cq-ab-tooltip-body">
            <div className="cq-ab-tooltip-line">
              The {field} is not in your book, and {runSentence(match.run)} with{" "}
              {match.target.origin === "book" ? "the entry" : "the registry entry"} “
              {match.target.label}”
              {match.target.detail ? ` (${match.target.detail})` : ""}.
            </div>
            <div className="cq-ab-tooltip-compare">
              <span className="cq-ab-tooltip-field">shown</span>
              <RunText text={match.text} run={match.run} />
              <span className="cq-ab-tooltip-field">known</span>
              <RunText text={match.target.text} run={match.run} />
            </div>
            <div className="cq-ab-tooltip-warn">
              An attacker grinds a key until its ends read like one you trust. Compare the whole
              string, not the ends.
            </div>
          </div>
          <Tooltip.Arrow className="cq-ab-tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export interface AddressBookMarkProps {
  address: string;
  match: AddressMatch | null;
  /** One line about where the registry data came from, for the registry badge. */
  registryNote?: string;
}

export function AddressBookMark({ address, match, registryNote = "" }: AddressBookMarkProps) {
  const { cred, credType } = useAddressCredentials(address);
  const [dialog, setDialog] = useState<"add" | "edit" | null>(null);
  const known = match?.kind === "known" ? match : null;
  const suggested =
    match?.kind === "registry"
      ? `${match.project?.label ?? match.script.projectId} · ${match.script.name}`
      : undefined;

  return (
    <span className="cq-ab-mark">
      <Tooltip.Provider delayDuration={200}>
        {match && (
          <MatchBadge
            match={match}
            registryNote={registryNote}
            onEdit={() => setDialog("edit")}
          />
        )}
        {!known && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                className="cq-ab-add"
                aria-label="Add this address to the address book"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setDialog("add");
                }}
              >
                <PlusIcon size={11} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="cq-ab-tooltip-small" sideOffset={6} side="top">
                Add to address book
                <Tooltip.Arrow className="cq-ab-tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )}
      </Tooltip.Provider>
      <AddressEntryDialog
        open={dialog !== null}
        onOpenChange={(open) => setDialog(open ? dialog : null)}
        address={address}
        cred={cred}
        credType={credType}
        entry={dialog === "edit" ? known?.entry : null}
        suggestedLabel={dialog === "add" ? suggested : undefined}
      />
    </span>
  );
}

export default AddressBookMark;
