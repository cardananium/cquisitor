"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  JsonTreeView,
  libJoinKey,
  plainMapEntries,
  type RenderRowArgs,
} from "@/components/jsonTree";
import { ChevronDownIcon } from "@/components/Icons";

// `depth < expanded` decides a node's initial open state in JsonTreeView.
// A huge number opens everything; depth 1 keeps only the root open.
const EXPAND_ALL_DEPTH = 1e9;
const COLLAPSE_DEPTH = 1;
const DEFAULT_DEPTH = 3;

// Searching walks the whole document, so it runs this long after the last
// keystroke rather than synchronously on every one.
const SEARCH_DEBOUNCE_MS = 200;

type Kind = "primitive" | "array" | "object";

function kindOf(v: unknown): Kind {
  if (v === null || typeof v !== "object") return "primitive";
  return Array.isArray(v) ? "array" : "object";
}

/** String form of a primitive — used for both matching and display. */
function primitiveText(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  return String(v);
}

/**
 * Splits `text` on case-insensitive occurrences of `query`, wrapping each
 * hit in a `<mark>`. Returns the plain string when there is nothing to mark.
 */
function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  let hit = haystack.indexOf(needle);
  let n = 0;
  while (hit !== -1) {
    if (hit > from) parts.push(text.slice(from, hit));
    parts.push(
      <mark key={n++} className="json-viewer-hl">
        {text.slice(hit, hit + needle.length)}
      </mark>
    );
    from = hit + needle.length;
    hit = haystack.indexOf(needle, from);
  }
  if (parts.length === 0) return text;
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

/**
 * Collects, in document order, the paths of every node whose (string) key or
 * primitive value contains `query`. Paths are built with the same scheme as
 * `JsonTreeView` (`libJoinKey`, root `"$"`) so they line up with the
 * `highlightedPaths` prop.
 */
function collectMatches(data: unknown, query: string): string[] {
  if (!query) return [];
  const needle = query.toLowerCase();
  const out: string[] = [];
  const walk = (
    value: unknown,
    path: string,
    keyLabel: string | number | null
  ) => {
    const kind = kindOf(value);
    const keyHit =
      typeof keyLabel === "string" && keyLabel.toLowerCase().includes(needle);
    const valueHit =
      kind === "primitive" &&
      primitiveText(value).toLowerCase().includes(needle);
    if (keyHit || valueHit) out.push(path);
    if (kind === "array") {
      (value as unknown[]).forEach((v, i) =>
        walk(v, libJoinKey(path, i, { isArrayItem: true }), i)
      );
    } else if (kind === "object") {
      for (const { key, value: v } of plainMapEntries(value)) {
        walk(v, libJoinKey(path, key, { isArrayItem: false }), key);
      }
    }
  };
  walk(data, "$", null);
  return out;
}

function renderPrimitive(v: unknown, query: string): React.ReactNode {
  if (v === null) return <span className="cq-json-null">null</span>;
  if (typeof v === "string")
    return (
      <span className="cq-json-string">&quot;{highlight(v, query)}&quot;</span>
    );
  if (typeof v === "number" || typeof v === "bigint")
    return <span className="cq-json-number">{highlight(String(v), query)}</span>;
  if (typeof v === "boolean")
    return <span className="cq-json-bool">{String(v)}</span>;
  return <span>{String(v)}</span>;
}

/** Header line for one tree node. `query` drives substring highlighting. */
function Row({
  keyLabel,
  value,
  isArrayItem,
  isComplex,
  isOpen,
  toggle,
  childCount,
  kind,
  query,
}: RenderRowArgs & { query: string }) {
  const keyEl =
    keyLabel === null ? null : (
      <span className={`cq-json-key${isArrayItem ? " cq-json-array-key" : ""}`}>
        {isArrayItem ? `[${keyLabel}]` : highlight(String(keyLabel), query)}
      </span>
    );

  if (!isComplex) {
    return (
      <>
        {keyEl}
        {keyEl && <span className="cq-json-colon">:</span>}
        {renderPrimitive(value, query)}
      </>
    );
  }

  const isArray = kind === "array";
  return (
    <>
      <button
        type="button"
        className={`cq-json-toggle${isOpen ? " open" : ""}`}
        onClick={toggle}
        aria-label={isOpen ? "Collapse" : "Expand"}
        tabIndex={-1}
      >
        <ChevronDownIcon
          size={12}
          className={`json-viewer-chevron${isOpen ? "" : " collapsed"}`}
        />
      </button>
      {keyEl}
      {keyEl && <span className="cq-json-colon">:</span>}
      <span className="cq-json-bracket">{isArray ? "[" : "{"}</span>
      {!isOpen && (
        <span className="cq-json-summary">
          {childCount} {isArray ? "items" : "fields"}
        </span>
      )}
      {!isOpen && (
        <span className="cq-json-bracket">{isArray ? "]" : "}"}</span>
      )}
    </>
  );
}

/**
 * Full JSON document view: a debounced search bar (with match navigation),
 * expand-all / collapse-all controls, and the tree itself.
 */
export default function JsonDocumentView({ data }: { data: unknown }) {
  // `query` follows the input on every keystroke; `searchQuery` is the
  // debounced, trimmed value that actually drives matching.
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  // Bumping `treeKey` remounts JsonTreeView so every node re-derives its
  // open state from `baseExpanded` — that is how expand/collapse-all work.
  const [treeKey, setTreeKey] = useState(0);
  const [baseExpanded, setBaseExpanded] = useState(DEFAULT_DEPTH);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Debounce: commit the trimmed query a short beat after typing stops.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === searchQuery) return;
    const id = window.setTimeout(() => {
      setSearchQuery(trimmed);
      setCurrentIndex(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query, searchQuery]);

  const matches = useMemo(
    () => collectMatches(data, searchQuery),
    [data, searchQuery]
  );
  const currentPath = matches[currentIndex] ?? null;

  const renderRow = useCallback(
    (args: RenderRowArgs) => <Row {...args} query={searchQuery} />,
    [searchQuery]
  );

  const renderClosingRow = useCallback(
    ({ kind }: { kind: "array" | "object" }) => (
      <div className="cq-json-row json-viewer-row">
        <span className="cq-json-bracket">{kind === "array" ? "]" : "}"}</span>
      </div>
    ),
    []
  );

  const getRowClassName = useCallback(
    (ctx: RenderRowArgs) =>
      currentPath && ctx.path === currentPath ? "json-viewer-current-row" : "",
    [currentPath]
  );

  // Scroll the active match into view. Ancestors are auto-expanded by
  // JsonTreeView (highlighted descendant ⇒ open), so the row exists by the
  // time this effect runs after the commit.
  useEffect(() => {
    if (!currentPath) return;
    const el = bodyRef.current?.querySelector(".json-viewer-current-row");
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentPath, treeKey]);

  // Memoised so typing — which only updates `query` — never re-renders the
  // tree; it re-renders only when the committed search, navigation or
  // expansion changes.
  const tree = useMemo(
    () => (
      <JsonTreeView
        key={treeKey}
        data={data}
        expanded={baseExpanded}
        mapEntries={plainMapEntries}
        highlightedPaths={matches}
        renderRow={renderRow}
        renderClosingRow={renderClosingRow}
        getRowClassName={getRowClassName}
        wrapperClassName="cq-json-tree json-viewer-tree"
        rowClassName="cq-json-row json-viewer-row"
        highlightedRowClassName="json-viewer-match-row"
        childrenClassName="cq-json-children"
        nodeBlockClassName="cq-json-block"
      />
    ),
    [
      treeKey,
      data,
      baseExpanded,
      matches,
      renderRow,
      renderClosingRow,
      getRowClassName,
    ]
  );

  const stepMatch = (delta: number) => {
    if (matches.length === 0) return;
    setCurrentIndex(
      (((currentIndex + delta) % matches.length) + matches.length) %
        matches.length
    );
  };

  const clearSearch = () => {
    setQuery("");
    setSearchQuery("");
    setCurrentIndex(0);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = query.trim();
      if (trimmed !== searchQuery) {
        // Commit a still-pending search immediately instead of waiting.
        setSearchQuery(trimmed);
        setCurrentIndex(0);
      } else {
        stepMatch(e.shiftKey ? -1 : 1);
      }
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      clearSearch();
    }
  };

  const setExpansion = (depth: number) => {
    setBaseExpanded(depth);
    setTreeKey((k) => k + 1);
  };

  const hasQuery = query.trim().length > 0;
  const searchPending = query.trim() !== searchQuery;

  return (
    <div className="json-viewer-doc">
      <div className="json-viewer-toolbar">
        <div className="json-viewer-search">
          <svg
            className="json-viewer-search-icon"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          <input
            type="text"
            value={query}
            placeholder="Search keys & values…"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {hasQuery && searchPending && (
            <span
              className="json-viewer-search-spinner animate-spin"
              role="status"
              aria-label="Searching"
            />
          )}
          {hasQuery && !searchPending && (
            <span className="json-viewer-match-count">
              {matches.length
                ? `${currentIndex + 1} / ${matches.length}`
                : "No matches"}
            </span>
          )}
          <button
            type="button"
            className="json-viewer-nav-btn"
            disabled={matches.length === 0}
            onClick={() => stepMatch(-1)}
            title="Previous match (Shift+Enter)"
          >
            <ChevronDownIcon size={13} style={{ transform: "rotate(180deg)" }} />
          </button>
          <button
            type="button"
            className="json-viewer-nav-btn"
            disabled={matches.length === 0}
            onClick={() => stepMatch(1)}
            title="Next match (Enter)"
          >
            <ChevronDownIcon size={13} />
          </button>
          {hasQuery && (
            <button
              type="button"
              className="json-viewer-clear-btn"
              onClick={clearSearch}
              title="Clear search (Esc)"
            >
              ✕
            </button>
          )}
        </div>
        <div className="json-viewer-toolbar-spacer" />
        <button
          type="button"
          className="json-viewer-tool-btn"
          onClick={() => setExpansion(COLLAPSE_DEPTH)}
        >
          Collapse all
        </button>
        <button
          type="button"
          className="json-viewer-tool-btn"
          onClick={() => setExpansion(EXPAND_ALL_DEPTH)}
        >
          Expand all
        </button>
      </div>
      <div className="json-viewer-doc-body" ref={bodyRef}>
        {tree}
      </div>
    </div>
  );
}
