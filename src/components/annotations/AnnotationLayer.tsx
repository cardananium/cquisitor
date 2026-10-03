"use client";

// Hint card for a tab's annotations: anchored next to the focused target while
// it is on screen, docked to the top of the tab when the target is unresolved
// or scrolled away. Carries the navigator (n / total, previous, next, the full
// list, dismiss all). Esc dismisses outside text fields.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  annotationStore,
  type AnnotationStatus,
  type AnnotationStore,
  type AnnotationTab,
  type CquisitorAnnotation,
  type TabAnnotations,
} from "@/utils/annotations/store";
import { annotationAnchorClass, describeTarget, severityOf } from "@/utils/annotations/marks";
import { useTabAnnotations } from "./useAnnotations";
import { boxIsEmpty, intersectBoxes, placeCard, type Box, type CardPlacement } from "./cardPlacement";

const SEVERITY_LABEL = { error: "Error", warning: "Warning", info: "Info" } as const;

/** Short status tag for an unresolved target; `null` once resolved. */
export function statusTag(status: AnnotationStatus | undefined): string | null {
  switch (status?.state) {
    case "resolved":
      return null;
    case "not_found":
      return "not found here";
    case "unsupported":
      return "not shown on this tab";
    default:
      return "waiting";
  }
}

export interface AnnotationCardProps {
  state: TabAnnotations;
  /** The card sits at the top of the tab rather than next to its target. */
  docked: boolean;
  /** The target is resolved but scrolled out of view. */
  offscreen: boolean;
  listOpen: boolean;
  onToggleList: () => void;
  onStep: (delta: number) => void;
  onFocus: (index: number) => void;
  onDismiss: () => void;
  onReveal: () => void;
}

function annotationTitle(annotation: CquisitorAnnotation): string {
  return annotation.label ?? describeTarget(annotation.target);
}

/** Card contents. Stateless so it renders the same on the server in tests. */
export function AnnotationCard({
  state,
  docked,
  offscreen,
  listOpen,
  onToggleList,
  onStep,
  onFocus,
  onDismiss,
  onReveal,
}: AnnotationCardProps) {
  const { annotations, focus, statuses } = state;
  const annotation = annotations[focus];
  const severity = severityOf(annotation);
  const status = statuses[focus];
  const tag = statusTag(status);
  const total = annotations.length;
  return (
    <div
      className={`cq-ann-card cq-ann-card-${severity}${docked ? " cq-ann-card-docked" : ""}`}
      role="dialog"
      aria-label="Annotation"
      data-annotation-card=""
    >
      <div className="cq-ann-card-head">
        <span className={`cq-ann-sev cq-ann-sev-${severity}`}>{SEVERITY_LABEL[severity]}</span>
        <span className="cq-ann-card-title" title={describeTarget(annotation.target)}>
          {annotationTitle(annotation)}
        </span>
        <button
          type="button"
          className="cq-ann-card-close"
          onClick={onDismiss}
          title="Dismiss all annotations (Esc)"
          aria-label="Dismiss all annotations"
        >
          ✕
        </button>
      </div>
      {tag && (
        <div className={`cq-ann-card-status cq-ann-status-${status?.state ?? "waiting"}`}>
          <strong>{tag[0].toUpperCase() + tag.slice(1)}</strong>
          {status?.note ? ` — ${status.note}` : ""}
        </div>
      )}
      {annotation.hint && <div className="cq-ann-card-hint">{annotation.hint}</div>}
      {offscreen && (
        <button type="button" className="cq-ann-card-reveal" onClick={onReveal}>
          Scroll to the target
        </button>
      )}
      <div className="cq-ann-nav">
        <button
          type="button"
          className="cq-ann-nav-btn"
          onClick={() => onStep(-1)}
          disabled={total < 2}
          aria-label="Previous annotation"
          title="Previous annotation"
        >
          ‹
        </button>
        <span className="cq-ann-nav-count" aria-live="polite">
          {focus + 1} / {total}
        </span>
        <button
          type="button"
          className="cq-ann-nav-btn"
          onClick={() => onStep(1)}
          disabled={total < 2}
          aria-label="Next annotation"
          title="Next annotation"
        >
          ›
        </button>
        {total > 1 && (
          <button
            type="button"
            className="cq-ann-nav-list"
            onClick={onToggleList}
            aria-expanded={listOpen}
          >
            {listOpen ? "Hide list" : "All"}
          </button>
        )}
        <span className="cq-flex-grow" />
        <button type="button" className="cq-ann-nav-dismiss" onClick={onDismiss}>
          Dismiss all
        </button>
      </div>
      {listOpen && total > 1 && (
        <ol className="cq-ann-list">
          {annotations.map((a, i) => {
            const t = statusTag(statuses[i]);
            return (
              <li key={i}>
                <button
                  type="button"
                  className={`cq-ann-list-item${i === focus ? " current" : ""}`}
                  onClick={() => onFocus(i)}
                  title={a.hint}
                >
                  <span className={`cq-ann-dot cq-ann-dot-${severityOf(a)}`} aria-hidden />
                  <span className="cq-ann-list-label">{annotationTitle(a)}</span>
                  {t && <span className="cq-ann-list-tag">{t}</span>}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function boxOf(r: DOMRect): Box {
  return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
}

function hasBox(el: Element): boolean {
  return el.getClientRects().length > 0;
}

function isScrollContainer(el: Element): boolean {
  const style = getComputedStyle(el);
  return /(auto|scroll|hidden|clip)/.test(`${style.overflow}${style.overflowX}${style.overflowY}`);
}

/** Nearest ancestor that clips `el`, or `root`. */
function clippingAncestor(el: Element, root: Element): Element {
  for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
    if (isScrollContainer(p)) return p;
  }
  return root;
}

/**
 * Box of a target drawn as several elements (a schema rule split into syntax
 * runs, a byte range broken by other highlights): the union of the pieces that
 * share the first piece's scroll container.
 */
function unionBox(first: Element, all: ArrayLike<Element>, root: Element): Box {
  const scope = clippingAncestor(first, root);
  let box = boxOf(first.getBoundingClientRect());
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el === first || !hasBox(el) || !scope.contains(el)) continue;
    const r = el.getBoundingClientRect();
    box = {
      top: Math.min(box.top, r.top),
      left: Math.min(box.left, r.left),
      bottom: Math.max(box.bottom, r.bottom),
      right: Math.max(box.right, r.right),
    };
  }
  return box;
}

/** The part of the page `el`'s scroll containers (up to `root`) leave visible. */
function visibleClip(el: Element, root: Element): Box {
  let clip: Box = { top: -Infinity, left: -Infinity, bottom: Infinity, right: Infinity };
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (isScrollContainer(p)) clip = intersectBoxes(clip, boxOf(p.getBoundingClientRect()));
    if (p === root) break;
  }
  return clip;
}

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT";
}

export interface AnnotationLayerProps {
  tab: AnnotationTab;
  /** Tab root: anchors are looked up inside it and an unanchored card docks to its top. */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * Bring annotation `index` forward (inner tab, dock panel, editor scroll).
   * Return true when it scrolled the target into view itself.
   */
  onReveal?: (index: number) => boolean | void;
  /** Element for `index` when no element carries its anchor class. */
  findAnchor?: (index: number, container: HTMLElement) => Element | null;
  store?: AnnotationStore;
}

interface Layout {
  hidden: boolean;
  placement: CardPlacement;
  offscreen: boolean;
}

const HIDDEN_LAYOUT: Layout = { hidden: true, placement: { top: 0, left: 0, mode: "docked" }, offscreen: false };

function sameLayout(a: Layout, b: Layout): boolean {
  return (
    a.hidden === b.hidden &&
    a.offscreen === b.offscreen &&
    a.placement.mode === b.placement.mode &&
    Math.round(a.placement.top) === Math.round(b.placement.top) &&
    Math.round(a.placement.left) === Math.round(b.placement.left)
  );
}

/** How many frames to look for a target that is still rendering before giving up on scrolling to it. */
const REVEAL_FRAMES = 40;

export default function AnnotationLayer({
  tab,
  containerRef,
  onReveal,
  findAnchor,
  store = annotationStore,
}: AnnotationLayerProps) {
  const state = useTabAnnotations(tab, store);
  const cardRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>(HIDDEN_LAYOUT);
  const [listOpen, setListOpen] = useState(false);
  const revealRef = useRef(onReveal);
  const findRef = useRef(findAnchor);
  useEffect(() => {
    revealRef.current = onReveal;
    findRef.current = findAnchor;
  }, [onReveal, findAnchor]);

  const focus = state?.focus ?? -1;
  const focusedState = state ? state.statuses[focus]?.state : undefined;
  const resolved = focusedState === "resolved";

  const anchorFor = useCallback((index: number): Element | null => {
    const container = containerRef.current;
    if (!container || index < 0) return null;
    const marked = container.querySelectorAll(`.${annotationAnchorClass(index)}`);
    for (let i = 0; i < marked.length; i++) if (hasBox(marked[i])) return marked[i];
    const found = findRef.current?.(index, container) ?? null;
    return found && hasBox(found) ? found : null;
  }, [containerRef]);

  // Bring the focused target on screen when focus moves or it resolves.
  const focusSeq = state?.focusSeq ?? 0;
  const reveal = useCallback(() => {
    if (focus < 0) return () => {};
    const handled = revealRef.current?.(focus) === true;
    if (handled) return () => {};
    let frames = 0;
    let raf = 0;
    const attempt = () => {
      const anchor = anchorFor(focus);
      if (anchor) {
        const container = containerRef.current;
        const clip = container ? visibleClip(anchor, container) : null;
        const box = boxOf(anchor.getBoundingClientRect());
        const shown = clip ? intersectBoxes(box, clip) : box;
        const fully = clip && shown.top <= box.top + 1 && shown.bottom >= Math.min(box.bottom, box.top + 40) - 1;
        if (boxIsEmpty(shown) || !fully) anchor.scrollIntoView({ block: "center", inline: "nearest" });
        return;
      }
      if (++frames < REVEAL_FRAMES) raf = requestAnimationFrame(attempt);
    };
    raf = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(raf);
  }, [focus, anchorFor, containerRef]);
  useEffect(() => {
    if (!resolved) return;
    return reveal();
    // focusSeq: a repeated request for the same index reveals it again.
  }, [resolved, reveal, focusSeq]);

  // Follow the target every frame: it moves with scrolling, re-renders and panel resizes.
  const active = state !== null;
  useLayoutEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const container = containerRef.current;
      const card = cardRef.current;
      if (!container || !card || !hasBox(container)) {
        setLayout((prev) => (prev.hidden ? prev : HIDDEN_LAYOUT));
        return;
      }
      const anchor = resolved ? anchorFor(focus) : null;
      const target = anchor
        ? unionBox(anchor, container.querySelectorAll(`.${annotationAnchorClass(focus)}`), container)
        : null;
      const clip = anchor ? visibleClip(anchor, container) : null;
      const placement = placeCard(
        target,
        clip,
        boxOf(container.getBoundingClientRect()),
        { width: card.offsetWidth, height: card.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      const next: Layout = {
        hidden: false,
        placement,
        offscreen: resolved && placement.mode === "docked",
      };
      setLayout((prev) => (sameLayout(prev, next) ? prev : next));
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [active, resolved, focus, anchorFor, containerRef]);

  const dismiss = useCallback(() => store.dismiss(tab), [store, tab]);
  const step = useCallback((delta: number) => store.step(tab, delta), [store, tab]);
  const focusIndex = useCallback((index: number) => store.focus(tab, index), [store, tab]);
  const toggleList = useCallback(() => setListOpen((v) => !v), []);

  // Esc dismisses, unless it is meant for a text field or something else already took it.
  useEffect(() => {
    if (!active || layout.hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const inCard = e.target instanceof Node && !!cardRef.current?.contains(e.target);
      if (!inCard && isEditable(e.target)) return;
      if (!inCard && document.querySelector("[role='dialog'][data-state='open']")) return;
      dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, layout.hidden, dismiss]);

  if (!state || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={cardRef}
      className="cq-ann-layer"
      style={{
        position: "fixed",
        top: layout.placement.top,
        left: layout.placement.left,
        visibility: layout.hidden ? "hidden" : "visible",
      }}
      data-placement={layout.placement.mode}
    >
      <AnnotationCard
        state={state}
        docked={layout.placement.mode === "docked"}
        offscreen={layout.offscreen}
        listOpen={listOpen}
        onToggleList={toggleList}
        onStep={step}
        onFocus={focusIndex}
        onDismiss={dismiss}
        onReveal={reveal}
      />
    </div>,
    document.body,
  );
}
