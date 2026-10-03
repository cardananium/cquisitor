// CDDL-tool targets: `cddl_range` / `cddl_rule` in the schema, `cbor_span` /
// `cbor_path` in the document — through the CBOR ⇄ CDDL map when it has the
// node (every panel lights up), else against the raw CBOR tree (hex and tree).

import type { CborPosition, CddlOutlineEntry, CddlRange } from "@cardananium/cquisitor-lib";
import type { CborCddlBridge, CborCddlNode } from "./cborCddlBridge";
import { preferRole } from "./cborCddlBridge";
import { findNodeByCborOffset, projectNode } from "./pinResolvers";
import type { OverlayMark } from "./cddlOverlay";
import type { AnnotationStatus, CquisitorAnnotation } from "@/utils/annotations/store";
import { annotationClassName, buildMarks, notShownHere, resolvedStatus } from "@/utils/annotations/marks";
import { hexSpansFor, resolveCborTarget, spanKey, type AnnotatedHexSpan, type CborDocument } from "@/utils/annotations/resolveCbor";

export interface CddlRuleLocation {
  /** The whole definition. */
  range: CddlRange;
  /** The rule's name in it, where the view scrolls to. */
  name: CddlRange;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Start of a rule definition: a name (generic parameters allowed) then `=`, `/=` or `//=`. */
const RULE_START = /^[ \t]*[A-Za-z@_$][\w@$.-]*[ \t]*(?:<[^>\n]*>)?[ \t]*(?:\/\/=|\/=|=)(?!>)/gm;

/**
 * Where rule `name` is defined. From the outline when it addresses this text
 * (the base definition, not a `/=` extension, when both exist); otherwise from
 * the text itself, up to the next definition.
 */
export function findCddlRule(
  name: string,
  cddl: string,
  outline: readonly CddlOutlineEntry[],
  outlineSource: string,
): CddlRuleLocation | null {
  if (!name || !cddl) return null;
  if (outlineSource === cddl) {
    const matches = outline.filter((e) => e.name === name);
    const entry = matches.find((e) => !e.is_alternate) ?? matches[0];
    if (entry) {
      const s = entry.span;
      const n = entry.name_span;
      return {
        range: [s.char_offset, s.char_offset + s.char_length],
        name: [n.char_offset, n.char_offset + n.char_length],
      };
    }
  }
  const own = new RegExp(
    `^[ \\t]*(${escapeRegExp(name)})[ \\t]*(?:<[^>\\n]*>)?[ \\t]*(//=|/=|=)(?!>)`,
    "gm",
  );
  let base: RegExpExecArray | null = null;
  let first: RegExpExecArray | null = null;
  for (let m = own.exec(cddl); m; m = own.exec(cddl)) {
    first ??= m;
    if (m[2] === "=") {
      base = m;
      break;
    }
  }
  const hit = base ?? first;
  if (!hit) return null;
  const nameStart = hit.index + hit[0].indexOf(hit[1]);
  RULE_START.lastIndex = hit.index + hit[0].length;
  const next = RULE_START.exec(cddl);
  let end = next ? next.index : cddl.length;
  while (end > nameStart && /\s/.test(cddl[end - 1])) end--;
  return { range: [nameStart, end], name: [nameStart, nameStart + name.length] };
}

export interface CddlResolveInput {
  cddl: string;
  outline: readonly CddlOutlineEntry[];
  outlineSource: string;
  /** True while a share link is still writing the document. */
  hydrating: boolean;
  bridge: CborCddlBridge;
  /** The document as the hex view and the structural tree show it. */
  cbor: CborDocument;
}

export interface CddlTargetResolution {
  status: AnnotationStatus;
  /** Schema range to mark. */
  cddl: CddlRange | null;
  /** Where in the schema to scroll; the start of `cddl` unless a rule name says otherwise. */
  cddlFocus: CddlRange | null;
  hex: CborPosition | null;
  tree: CborPosition | null;
  /** Decoded-JSON row path. */
  decoded: string | null;
  /** Panel the target is shown in first. */
  panel: "cddl" | "hex";
}

const UNSUPPORTED: CddlTargetResolution = {
  status: notShownHere(),
  cddl: null,
  cddlFocus: null,
  hex: null,
  tree: null,
  decoded: null,
  panel: "hex",
};

function fromNode(node: CborCddlNode, fallback: { hex: CborPosition | null; tree: CborPosition | null }) {
  const p = projectNode(node);
  return {
    cddl: p.cddl,
    hex: p.hex ?? fallback.hex,
    tree: p.tree ?? fallback.tree,
    decoded: p.decoded,
  };
}

function covers(outer: CborPosition | null | undefined, inner: CborPosition): boolean {
  return !!outer && inner.offset >= outer.offset && inner.offset + inner.length <= outer.offset + outer.length;
}

export function resolveCddlTarget(annotation: CquisitorAnnotation, input: CddlResolveInput): CddlTargetResolution {
  const { target } = annotation;
  switch (target.kind) {
    case "cddl_range": {
      const len = input.cddl.length;
      if (target.start >= len) {
        return {
          ...UNSUPPORTED,
          panel: "cddl",
          status: input.hydrating
            ? { state: "waiting", note: "Waiting for the shared schema to load." }
            : { state: "not_found", note: `The schema is ${len} characters; this range starts at ${target.start}.` },
        };
      }
      const range: CddlRange = [target.start, Math.min(target.end, len)];
      return { ...UNSUPPORTED, status: resolvedStatus(), cddl: range, cddlFocus: range, panel: "cddl" };
    }
    case "cddl_rule": {
      const found = findCddlRule(target.name, input.cddl, input.outline, input.outlineSource);
      if (!found) {
        return {
          ...UNSUPPORTED,
          panel: "cddl",
          status: input.hydrating
            ? { state: "waiting", note: "Waiting for the shared schema to load." }
            : { state: "not_found", note: `The schema defines no rule ${target.name}.` },
        };
      }
      return { ...UNSUPPORTED, status: resolvedStatus(), cddl: found.range, cddlFocus: found.name, panel: "cddl" };
    }
    case "cbor_span":
    case "cbor_path": {
      const raw = resolveCborTarget(annotation, input.cbor);
      let node: CborCddlNode | null = null;
      if (target.kind === "cbor_path") {
        const entry = preferRole(input.bridge.entriesAtCborPath(target.path), "value");
        node = entry ? input.bridge.node(entry) : null;
      } else if (raw.hex) {
        const candidate = findNodeByCborOffset(input.bridge, raw.hex.offset);
        node = candidate && covers(candidate.entry.cbor_anchor_span, raw.hex) ? candidate : null;
      }
      if (!node) {
        return {
          ...UNSUPPORTED,
          status: raw.status.state === "not_found" && input.hydrating
            ? { state: "waiting", note: "Waiting for the shared document to load." }
            : raw.status,
          hex: raw.hex,
          tree: raw.tree,
        };
      }
      const projected = fromNode(node, raw);
      // A span target keeps its own bytes; the map's node only adds the other panels.
      const hex = target.kind === "cbor_span" ? raw.hex : projected.hex;
      return {
        status: resolvedStatus(),
        cddl: projected.cddl,
        cddlFocus: projected.cddl,
        hex,
        tree: projected.tree,
        decoded: projected.decoded,
        panel: "hex",
      };
    }
    default:
      return UNSUPPORTED;
  }
}

/** Editor marks rank above mismatches and below schema errors and the pin. */
export const PRIORITY_ANNOTATION = 95;
export const PRIORITY_ANNOTATION_FOCUSED = 96;

export interface CddlMarks {
  editor: OverlayMark[];
  hexSpans: AnnotatedHexSpan[];
  treeRows: Map<string, string>;
  treeOpen: CborPosition[];
  decodedRows: Map<string, string>;
  decodedOpen: string[];
}

export function cddlMarks(
  resolutions: readonly CddlTargetResolution[],
  annotations: readonly CquisitorAnnotation[],
  focus: number,
): CddlMarks {
  const editor: Array<{ key: string; index: number }> = [];
  const hex: Array<{ key: string; index: number }> = [];
  const tree: Array<{ key: string; index: number }> = [];
  const decoded: Array<{ key: string; index: number }> = [];
  const treeOpen: CborPosition[] = [];
  const decodedOpen: string[] = [];
  resolutions.forEach((r, index) => {
    if (r.cddl) editor.push({ key: `${r.cddl[0]}:${r.cddl[1]}`, index });
    if (r.hex) hex.push({ key: spanKey(r.hex), index });
    if (r.tree) {
      tree.push({ key: spanKey(r.tree), index });
      treeOpen.push(r.tree);
    }
    if (r.decoded) {
      decoded.push({ key: r.decoded, index });
      decodedOpen.push(r.decoded);
    }
  });
  const editorMarks: OverlayMark[] = [];
  for (const [key, mark] of buildMarks(editor, annotations, focus)) {
    const [start, end] = key.split(":").map(Number);
    editorMarks.push({
      range: [start, end],
      className: annotationClassName(mark),
      message: annotations[mark.indices[0]].label ?? null,
      priority: mark.focused ? PRIORITY_ANNOTATION_FOCUSED : PRIORITY_ANNOTATION,
    });
  }
  const classes = (items: Array<{ key: string; index: number }>) => {
    const out = new Map<string, string>();
    for (const [key, mark] of buildMarks(items, annotations, focus)) out.set(key, annotationClassName(mark));
    return out;
  };
  return {
    editor: editorMarks,
    hexSpans: hexSpansFor(buildMarks(hex, annotations, focus)),
    treeRows: classes(tree),
    treeOpen,
    decodedRows: classes(decoded),
    decodedOpen,
  };
}
