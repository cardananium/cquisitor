// Which rule to validate against, and which rules to offer. Pure functions of the outline plus the last pick.

import type { CddlOutlineEntry } from "@cardananium/cquisitor-lib";
import { rootKindsAdmit, ruleRootKinds } from "./rootKinds";

/**
 * A rule that declares generic parameters (`set<a0> = [* a0]`) cannot be a validation root — outside a use site its parameters are unbound.
 * Detected by `<` immediately after the name span; `source` must be the schema the outline was produced from.
 */
export function isParameterisedRule(entry: CddlOutlineEntry, source: string): boolean {
  const span = entry.name_span;
  if (!span) return false;
  return source[span.char_offset + span.char_length] === "<";
}

/** Outline together with the schema text its spans address. */
export interface OutlineSnapshot {
  source: string;
  outline: CddlOutlineEntry[];
}

/**
 * Outline the UI should keep showing. `cddl_outline` yields nothing mid-keystroke, so those states keep `prev` rather than emptying the list; an emptied schema replaces it.
 * Returns `prev` unchanged whenever nothing moved, so a caller can compare by identity.
 */
export function retainOutline(
  prev: OutlineSnapshot,
  source: string,
  fresh: CddlOutlineEntry[],
): OutlineSnapshot {
  if (fresh.length === 0 && source.trim() !== "") return prev;
  if (prev.source === source && prev.outline === fresh) return prev;
  return { source, outline: fresh };
}

/** Every rule name the schema declares, in source order, deduped. Used to colour references — generics and group rules included. */
export function declaredRuleNames(outline: CddlOutlineEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of outline) {
    if (!e.name || seen.has(e.name)) continue;
    seen.add(e.name);
    out.push(e.name);
  }
  return out;
}

/** Rules that can be a validation root: type rules (`name = …`) with no generic parameters. */
export function rootRuleNames(outline: CddlOutlineEntry[], source: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of outline) {
    if (e.kind !== "type" || !e.name) continue;
    if (seen.has(e.name)) continue;
    if (isParameterisedRule(e, source)) continue;
    seen.add(e.name);
    out.push(e.name);
  }
  return out;
}

/**
 * Rule the validator actually runs against. The pick wins while the schema still declares it; otherwise the first declared root stands in.
 * With no roots, the free-text name is all there is.
 */
export function resolveRootRule(ruleNames: string[], picked: string, typed: string): string {
  if (ruleNames.length === 0) return typed.trim();
  if (ruleNames.includes(picked)) return picked;
  return ruleNames[0];
}

/**
 * Other roots worth trying after a root-level refusal: every root except `current`, minus those whose text cannot accept `rootKind`.
 * The filter only drops what the validator would refuse; a rule whose kind the text does not settle is kept. Declaration order.
 */
export function candidateRootRules(
  outline: CddlOutlineEntry[],
  source: string,
  current: string,
  rootKind: string | null,
): string[] {
  return rootRuleNames(outline, source).filter(
    name => name !== current && rootKindsAdmit(ruleRootKinds(name, outline, source), rootKind),
  );
}

/**
 * Ranked substring filter for the rule picker: exact match, then prefix, then contains, each group in source order.
 */
export function filterRuleNames(names: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return names;
  const exact: string[] = [];
  const prefix: string[] = [];
  const rest: string[] = [];
  for (const n of names) {
    const l = n.toLowerCase();
    if (l === q) exact.push(n);
    else if (l.startsWith(q)) prefix.push(n);
    else if (l.includes(q)) rest.push(n);
  }
  return [...exact, ...prefix, ...rest];
}
