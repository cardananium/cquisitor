"use client";

// Hint card for a tab's annotations: anchored next to the focused target while
// it is on screen, docked to the top of the tab when the target is unresolved
// or scrolled away. Carries the navigator (n / total, previous, next, the full
// list, the spotlight on or off). The card's head drags it aside, on top of its
// placement. ✕ in the head, or Esc outside text fields, closes the annotations.
// While the spotlight is on, a dark scrim covers the page except for the parts
// of the focused target that are on screen.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
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
import {
  clipToContainers,
  focusedHoles,
  sameHoles,
  scrimVisible,
  spotlightStore,
  type ScrimHole,
  type SpotlightStore,
  type TargetPart,
} from "@/utils/annotations/scrim";
import { useSpotlightEnabled, useTabAnnotations } from "./useAnnotations";
import AnnotationScrim from "./AnnotationScrim";
import {
  anchorOf,
  boxIsEmpty,
  clampOffset,
  dragKey,
  intersectBoxes,
  offsetFor,
  placeCard,
  type Box,
  type CardAnchor,
  type CardDrag,
  type CardOffset,
  type CardPlacement,
} from "./cardPlacement";

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
  /** The scrim darkens the page around the focused target. */
  spotlight: boolean;
  onToggleList: () => void;
  onToggleSpotlight: () => void;
  onStep: (delta: number) => void;
  onFocus: (index: number) => void;
  onDismiss: () => void;
  onReveal: () => void;
  /** Pointer handlers that drag the card by its head. */
  dragHandle?: Pick<
    HTMLAttributes<HTMLDivElement>,
    "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onLostPointerCapture"
  >;
  /** The card is being dragged. */
  dragging?: boolean;
}

function annotationTitle(annotation: CquisitorAnnotation): string {
  return annotation.label ?? describeTarget(annotation.target);
}

/** Spotlight glyph: a ring around a filled dot. */
function SpotlightIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden focusable="false">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2.75" fill="currentColor" />
    </svg>
  );
}

/** Card contents. Stateless so it renders the same on the server in tests. */
export function AnnotationCard({
  state,
  docked,
  offscreen,
  listOpen,
  spotlight,
  onToggleList,
  onToggleSpotlight,
  onStep,
  onFocus,
  onDismiss,
  onReveal,
  dragHandle,
  dragging = false,
}: AnnotationCardProps) {
  const { annotations, focus, statuses } = state;
  const annotation = annotations[focus];
  const severity = severityOf(annotation);
  const status = statuses[focus];
  const tag = statusTag(status);
  const total = annotations.length;
  return (
    <div
      className={`cq-ann-card cq-ann-card-${severity}${docked ? " cq-ann-card-docked" : ""}${dragging ? " cq-ann-card-dragging" : ""}`}
      role="dialog"
      aria-label="Annotation"
      data-annotation-card=""
    >
      <div className="cq-ann-card-head" title="Drag to move" {...dragHandle}>
        <span className="cq-ann-grip" aria-hidden />
        <span className={`cq-ann-sev cq-ann-sev-${severity}`}>{SEVERITY_LABEL[severity]}</span>
        <span className="cq-ann-card-title" title={describeTarget(annotation.target)}>
          {annotationTitle(annotation)}
        </span>
        <button
          type="button"
          className="cq-ann-card-close"
          onClick={onDismiss}
          title="Close annotations (Esc)"
          aria-label="Close annotations (Esc)"
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
        <button
          type="button"
          className="cq-ann-nav-btn cq-ann-nav-spot"
          onClick={onToggleSpotlight}
          aria-pressed={spotlight}
          aria-label="Spotlight"
          title={spotlight ? "Spotlight: on" : "Spotlight: off"}
        >
          <SpotlightIcon />
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

/**
 * Boxes of `el` and every container around it that clips, innermost first.
 * Memoised per frame in `cache`, so pieces sharing ancestors walk them once.
 */
function clipsFrom(el: Element | null, cache: Map<Element, readonly Box[]>): readonly Box[] {
  if (!el || el === document.documentElement) return [];
  const known = cache.get(el);
  if (known) return known;
  const outer = clipsFrom(el.parentElement, cache);
  const clips = isScrollContainer(el) ? [boxOf(el.getBoundingClientRect()), ...outer] : outer;
  cache.set(el, clips);
  return clips;
}

function sameLine(a: Box, b: Box): boolean {
  return Math.abs(a.top - b.top) < 2 && Math.abs(a.bottom - b.bottom) < 2 && b.left <= a.right + 2 && a.left <= b.right + 2;
}

/** `b` is the next line of a wrapped text block that `a` covers, about as wide. */
function nextLine(a: Box, b: Box): boolean {
  return b.top >= a.top && b.top - a.bottom < 6 && Math.abs(a.left - b.left) <= 12 && Math.abs(a.right - b.right) <= 12;
}

function contains(outer: Box, inner: Box): boolean {
  return outer.top <= inner.top && outer.left <= inner.left && outer.bottom >= inner.bottom && outer.right >= inner.right;
}

/**
 * The visible pieces of annotation `index`: one per line box of each element
 * carrying its anchor class (or of `fallback`), each cut to its scroll
 * containers. Pieces on one line that touch, and the lines of a wrapped block,
 * are merged; pieces inside another are dropped.
 */
function targetParts(index: number, elements: ArrayLike<Element>, fallback: Element | null): TargetPart[] {
  const cache = new Map<Element, readonly Box[]>();
  const parts: TargetPart[] = [];
  const add = (el: Element) => {
    const clips = clipsFrom(el.parentElement, cache);
    // Most pieces of a long target are scrolled away: skip them before reading their line boxes.
    const bounds = boxOf(el.getBoundingClientRect());
    if (bounds.bottom <= bounds.top && bounds.right <= bounds.left) return;
    const visible = clipToContainers(bounds, clips);
    if (!visible) return;
    const rects = el.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const shown = clipToContainers(boxOf(rects[i]), clips);
      if (!shown) continue;
      const last = parts[parts.length - 1];
      if (last && (sameLine(last.box, shown) || nextLine(last.box, shown))) {
        last.box = {
          top: Math.min(last.box.top, shown.top),
          left: Math.min(last.box.left, shown.left),
          bottom: Math.max(last.box.bottom, shown.bottom),
          right: Math.max(last.box.right, shown.right),
        };
        continue;
      }
      parts.push({ index, box: shown, clips: [] });
    }
  };
  for (let i = 0; i < elements.length; i++) add(elements[i]);
  if (parts.length === 0 && fallback) add(fallback);
  return parts.filter((p) => !parts.some((q) => q !== p && contains(q.box, p.box) && !contains(p.box, q.box)));
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
  spotlight?: SpotlightStore;
}

interface Scrim {
  visible: boolean;
  /** Kept while hidden, so the scrim fades out around the last holes. */
  holes: readonly ScrimHole[];
}

const NO_SCRIM: Scrim = { visible: false, holes: [] };

interface Layout {
  hidden: boolean;
  /** Where the card is drawn: its placement moved by the drag offset. */
  placement: CardPlacement;
  offscreen: boolean;
}

/** The side the card took in the last frame, and the focus request and viewport it was placed for. */
interface Kept {
  focusSeq: number;
  width: number;
  height: number;
  anchor: CardAnchor | null;
}

/** The placement measured in the last frame, which a drag moves the card from. */
interface Base {
  placement: CardPlacement;
  key: string;
  card: { width: number; height: number };
}

interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  start: CardOffset;
}

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function moved(placement: CardPlacement, offset: CardOffset): CardPlacement {
  return offset.x === 0 && offset.y === 0
    ? placement
    : { ...placement, top: placement.top + offset.y, left: placement.left + offset.x };
}

function hideScrim(prev: Scrim): Scrim {
  return prev.visible ? { visible: false, holes: prev.holes } : prev;
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
  spotlight = spotlightStore,
}: AnnotationLayerProps) {
  const state = useTabAnnotations(tab, store);
  const spotlightOn = useSpotlightEnabled(spotlight);
  const [scrim, setScrim] = useState<Scrim>(NO_SCRIM);
  const cardRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>(HIDDEN_LAYOUT);
  const [listOpen, setListOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<CardDrag | null>(null);
  const baseRef = useRef<Base | null>(null);
  const keptRef = useRef<Kept | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
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
  // The scrim's holes are measured in the same frame, only while the scrim can show.
  const active = state !== null;
  const measureHoles = active && resolved && spotlightOn;
  useLayoutEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const container = containerRef.current;
      const card = cardRef.current;
      if (!container || !card || !hasBox(container)) {
        baseRef.current = null;
        setLayout((prev) => (prev.hidden ? prev : HIDDEN_LAYOUT));
        setScrim(hideScrim);
        return;
      }
      const anchor = resolved ? anchorFor(focus) : null;
      const marked = anchor ? container.querySelectorAll(`.${annotationAnchorClass(focus)}`) : null;
      const target = anchor && marked ? unionBox(anchor, marked, container) : null;
      const parts = anchor && marked ? targetParts(focus, marked, anchor) : [];
      if (measureHoles && anchor && marked) {
        const viewport = viewportSize();
        const holes = focusedHoles(parts, focus, viewport);
        const visible = scrimVisible({ active, enabled: spotlightOn, resolved, holes });
        setScrim((prev) =>
          visible
            ? prev.visible && sameHoles(prev.holes, holes) ? prev : { visible, holes }
            : hideScrim(prev),
        );
      } else {
        setScrim(hideScrim);
      }
      const clip = anchor ? visibleClip(anchor, container) : null;
      const size = { width: card.offsetWidth, height: card.offsetHeight };
      const viewport = viewportSize();
      // The card keeps its side while the focus request and the viewport stay the same.
      const kept = keptRef.current;
      const same = !!kept && kept.focusSeq === focusSeq && kept.width === viewport.width && kept.height === viewport.height;
      const placement = placeCard(target, clip, boxOf(container.getBoundingClientRect()), size, viewport, {
        parts: parts.map((p) => p.box),
        keep: same ? kept.anchor : null,
      });
      keptRef.current = { focusSeq, ...viewport, anchor: anchorOf(placement) };
      const key = dragKey(focusSeq, placement.mode);
      if (dragRef.current && dragRef.current.key !== key) dragRef.current = null;
      baseRef.current = { placement, key, card: size };
      const offset = clampOffset(placement, offsetFor(dragRef.current, key), size, viewport);
      const next: Layout = {
        hidden: false,
        placement: moved(placement, offset),
        offscreen: resolved && placement.mode === "docked",
      };
      setLayout((prev) => (sameLayout(prev, next) ? prev : next));
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [active, resolved, focus, focusSeq, anchorFor, containerRef, measureHoles, spotlightOn]);

  // Closed annotations forget the drag; the next link starts from the placement.
  useEffect(() => {
    if (!active) return;
    return () => {
      dragRef.current = null;
      gestureRef.current = null;
      setDragging(false);
    };
  }, [active]);

  // Dragging the head moves the card by an offset over its placement, so it
  // keeps following the target; the offset is kept inside the viewport.
  const onDragStart = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !e.isPrimary || gestureRef.current) return;
    if (e.target instanceof Element && e.target.closest("button, a, input, select, textarea")) return;
    const base = baseRef.current;
    if (!base) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    gestureRef.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      start: offsetFor(dragRef.current, base.key),
    };
    setDragging(true);
  }, []);
  const onDragMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const base = baseRef.current;
    if (!gesture || !base || e.pointerId !== gesture.pointerId) return;
    const offset = clampOffset(
      base.placement,
      { x: gesture.start.x + e.clientX - gesture.x, y: gesture.start.y + e.clientY - gesture.y },
      base.card,
      viewportSize(),
    );
    dragRef.current = { key: base.key, offset };
    const placement = moved(base.placement, offset);
    setLayout((prev) => (prev.hidden ? prev : { ...prev, placement }));
  }, []);
  const onDragEnd = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  }, []);

  const dismiss = useCallback(() => store.dismiss(tab), [store, tab]);
  const step = useCallback((delta: number) => store.step(tab, delta), [store, tab]);
  const focusIndex = useCallback((index: number) => store.focus(tab, index), [store, tab]);
  const toggleList = useCallback(() => setListOpen((v) => !v), []);
  const toggleSpotlight = useCallback(() => spotlight.setEnabled(!spotlight.enabled()), [spotlight]);

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
  return (
    <>
      <AnnotationScrim visible={scrim.visible && !layout.hidden} holes={scrim.holes} />
      {createPortal(
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
            spotlight={spotlightOn}
            onToggleList={toggleList}
            onToggleSpotlight={toggleSpotlight}
            onStep={step}
            onFocus={focusIndex}
            onDismiss={dismiss}
            onReveal={reveal}
            dragHandle={{
              onPointerDown: onDragStart,
              onPointerMove: onDragMove,
              onPointerUp: onDragEnd,
              onPointerCancel: onDragEnd,
              onLostPointerCapture: onDragEnd,
            }}
            dragging={dragging}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
