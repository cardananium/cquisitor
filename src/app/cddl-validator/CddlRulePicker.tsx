"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { filterRuleNames } from "./ruleSelection";

interface CddlRulePickerProps {
  /** Rules that can be a validation root, in schema order. */
  ruleNames: string[];
  /** The rule validation is actually running against. */
  rule: string;
  /** Raw text of the picker — only differs from `rule` while it's typed. */
  typedRule: string;
  onPick: (rule: string) => void;
  /** The rule list comes from the last schema that parsed. */
  stale?: boolean;
  /** Schema parsed but no type rule without generics; the fallback input says that instead of “nothing parsed yet”. */
  noRoot?: boolean;
}

/** Why a schema that parses can still offer no root. */
export const NO_ROOT_RULE_NOTE =
  "This schema declares no rule that can be a validation root — a root has to be a type rule"
  + " (name = …) without generic parameters.";

const NOT_PARSED_NOTE = "No rules parsed out of this schema yet — type the root rule name";

/**
 * Root-rule picker. Filterable because a ledger schema has 100+ rules; falls back to a text input when none are known.
 */
export default function CddlRulePicker({
  ruleNames,
  rule,
  typedRule,
  onPick,
  stale,
  noRoot = false,
}: CddlRulePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const matches = useMemo(() => filterRuleNames(ruleNames, query), [ruleNames, query]);

  const close = useCallback(() => setOpen(false), []);
  // Keyboard close restores focus to the trigger; the filter input is about to unmount.
  const closeFromKeyboard = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  const commit = useCallback((name: string) => {
    onPick(name);
    setOpen(false);
  }, [onPick]);

  const openList = useCallback(() => {
    setQuery("");
    setActive(Math.max(0, ruleNames.indexOf(rule)));
    setOpen(true);
  }, [ruleNames, rule]);

  // Click elsewhere dismisses the list, like a native <select>.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // Keyboard navigation has to bring its target into view — a ledger schema's list is far longer than the panel.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active, matches]);

  const onSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (matches.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive(i => (i + step + matches.length) % matches.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const pick = matches[active];
      if (pick) {
        commit(pick);
        triggerRef.current?.focus();
      }
      return;
    }
    if (e.key === "Escape") {
      // preventDefault so a sheet elsewhere on the page does not also close.
      e.preventDefault();
      closeFromKeyboard();
      return;
    }
    if (e.key === "Tab") close();
  }, [matches, active, commit, close, closeFromKeyboard]);

  if (ruleNames.length === 0) {
    return (
      <input
        type="text"
        className="cddl-rule-picker-input"
        value={typedRule}
        onChange={(e) => onPick(e.target.value)}
        placeholder={noRoot ? "no root rule" : "root rule"}
        title={noRoot ? NO_ROOT_RULE_NOTE : NOT_PARSED_NOTE}
        aria-label="Root rule"
      />
    );
  }

  const staleNote = stale ? " (from the last schema that parsed)" : "";

  return (
    <div className="cddl-rule-combo" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`cddl-rule-combo-trigger${stale ? " cddl-rule-combo-stale" : ""}`}
        onClick={() => (open ? close() : openList())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        title={`${rule || "no rule"} — ${ruleNames.length} rule${ruleNames.length === 1 ? "" : "s"} to choose from${staleNote}`}
      >
        <span className="cddl-rule-combo-value">{rule || "—"}</span>
        <span className="cddl-rule-combo-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="cddl-rule-combo-panel">
          <input
            ref={searchRef}
            type="text"
            className="cddl-rule-combo-search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onSearchKeyDown}
            placeholder={`filter ${ruleNames.length} rule${ruleNames.length === 1 ? "" : "s"}…`}
            aria-label="Filter rules"
            aria-controls={listId}
          />
          <ul className="cddl-rule-combo-list" id={listId} role="listbox" ref={listRef}>
            {matches.map((name, i) => (
              <li
                key={name}
                role="option"
                aria-selected={name === rule}
                data-active={i === active ? "true" : undefined}
                className={
                  "cddl-rule-combo-option" +
                  (i === active ? " cddl-rule-combo-option-active" : "") +
                  (name === rule ? " cddl-rule-combo-option-current" : "")
                }
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(name)}
              >
                {name}
              </li>
            ))}
            {matches.length === 0 && (
              <li className="cddl-rule-combo-empty">no rule matches “{query.trim()}”</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
