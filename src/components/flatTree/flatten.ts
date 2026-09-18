// Flatten a tree to the list of rows a viewer shows.
// Walk uses an explicit stack; rows are siblings indented by depth, so DOM/call-stack depth does not follow the data.
// Single-child chains fold to one row; `limit` stops the walk so huge open trees page.

/** How a viewer reads its own node type. */
export interface FlatTreeAdapter<N, L = unknown> {
  /** The node's children in display order; `[]` for a leaf. */
  childrenOf(node: N): ReadonlyArray<FlatChild<N, L>>;
  /** Whether the node can have children. Empty containers still get a toggle. */
  isContainer(node: N): boolean;
  /** Child path from parent path (parent plus one segment). */
  childPath(parentPath: string, child: FlatChild<N, L>): string;
  /** Highlight-route step for this child (`splitPath` segment). Matched one level at a time, not by whole-path compare. */
  stepOf(child: FlatChild<N, L>): string;
}

/** One child of a container. */
export interface FlatChild<N, L = unknown> {
  key: string | number;
  node: N;
  /** True when the parent is an array, so the viewer renders `[i]`. */
  isArrayItem: boolean;
  /** Viewer-specific: which half of a map entry this is, say. */
  label?: L;
}

export type FlatRowKind = "leaf" | "closed" | "open" | "closing";

/** A run of single-child containers shown as one row. */
export interface FlatFold {
  /** How many nodes the row stands for, the last one included. */
  levels: number;
  /** The key of every node in the run, outermost first. */
  keys: ReadonlyArray<string | number>;
}

export interface FlatRow<N, L = unknown> {
  /** Node path (row identity). For a folded run, the last node's path. */
  path: string;
  /** First node of a folded run — collapsing closes this. Own path when not folded. */
  foldStartPath: string;
  /** The first node of a folded run; the row's own node otherwise. */
  foldStartNode: N;
  node: N;
  /** Indent: open rows above, not data depth. */
  depth: number;
  /** Depth in the data; differs from `depth` after a fold above. */
  dataDepth: number;
  key: string | number | null;
  isArrayItem: boolean;
  label: L | undefined;
  kind: FlatRowKind;
  childCount: number;
  isHighlighted: boolean;
  /** Open ancestor on the way to a highlighted node. */
  onHighlightRoute: boolean;
  fold: FlatFold | null;
  /** How many levels of data lie below this node: 0 for a leaf. */
  depthBelow: number;
}

export interface FlattenOptions<N, L = unknown> {
  adapter: FlatTreeAdapter<N, L>;
  rootPath: string;
  /**
   * Whether a container is open. `chainOpen` is true when a folded-row toggle opened the single-child ancestors above.
   * Asked once per container on a folded run; keying on `path` is O(depth²) for a long chain.
   */
  isOpen(args: {
    path: string;
    node: N;
    depth: number;
    onHighlightRoute: boolean;
    chainOpen: boolean;
  }): boolean;
  /** If true, opening this node opens the single-child chain below (one click to the end). */
  opensChain?: boolean;
  /** Highlighted nodes, each as the steps from the root — see `stepOf`. */
  highlightRoutes?: ReadonlyArray<ReadonlyArray<string>>;
  /** Routes from this index are opened and kept as their own row, but not highlighted. */
  unmarkedRoutesFrom?: number;
  /** Fold a run of single-child containers this long or longer into one row. Off when absent. */
  foldChainsFrom?: number;
  /** Emit a closing row after an open container's children. */
  closingRows?: boolean;
  /** Leave the root's own row out and show its children at depth 0. */
  skipRoot?: boolean;
  /** Stop after this many rows. */
  limit?: number;
  /** `depthBelow` for containers, from `depthBelowMap`. */
  depthBelow?: WeakMap<object, number>;
}

export interface FlatTree<N, L = unknown> {
  rows: FlatRow<N, L>[];
  /** True when the walk stopped at `limit` with rows still to show. */
  truncated: boolean;
}

/**
 * Unique list key per row: `ordinal:path`, because wire-order duplicate keys share a path.
 * `ids` is what each row is keyed by before the ordinal, when a view keys some rows by more than their path.
 */
export function rowKeys(ids: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const ordinal = seen.get(id) ?? 0;
    seen.set(id, ordinal + 1);
    return `${ordinal}:${id}`;
  });
}

interface Frame<N, L> {
  path: string;
  node: N;
  children: ReadonlyArray<FlatChild<N, L>>;
  next: number;
  /** Indentation of this container's children. */
  childDepth: number;
  childDataDepth: number;
  /** Indices of the highlight routes this container lies on. */
  routes: ReadonlyArray<number>;
  /** Whether a chain opened above reaches this container's only child. */
  chainOpen: boolean;
  /** The closing row to emit once the children are done. */
  closing: FlatRow<N, L> | null;
}

const NO_ROUTES: ReadonlyArray<number> = [];

/**
 * Levels below each container from `root`. Leaves are omitted (callers treat missing as 0).
 */
export function depthBelowMap<N, L>(
  root: N,
  adapter: FlatTreeAdapter<N, L>,
): WeakMap<object, number> {
  const out = new WeakMap<object, number>();
  if (!isObject(root) || !adapter.isContainer(root)) return out;
  // Post-order with an explicit stack: a container's depth is settled once
  // every child has been.
  const stack: Array<{ node: N; children: ReadonlyArray<FlatChild<N, L>>; next: number; deepest: number }> = [
    { node: root, children: adapter.childrenOf(root), next: 0, deepest: 0 },
  ];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.next < frame.children.length) {
      const child = frame.children[frame.next++].node;
      if (isObject(child) && adapter.isContainer(child)) {
        stack.push({ node: child, children: adapter.childrenOf(child), next: 0, deepest: 0 });
      } else {
        frame.deepest = Math.max(frame.deepest, 1);
      }
      continue;
    }
    stack.pop();
    out.set(frame.node as object, frame.deepest);
    const parent = stack[stack.length - 1];
    if (parent) parent.deepest = Math.max(parent.deepest, frame.deepest + 1);
  }
  return out;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** The rows a viewer shows of `root`. */
export function flattenTree<N, L = unknown>(
  root: N,
  options: FlattenOptions<N, L>,
): FlatTree<N, L> {
  const {
    adapter,
    rootPath,
    isOpen,
    opensChain = false,
    highlightRoutes = [],
    unmarkedRoutesFrom = Infinity,
    foldChainsFrom = Infinity,
    closingRows = false,
    skipRoot = false,
    limit = Infinity,
    depthBelow,
  } = options;

  const rows: FlatRow<N, L>[] = [];
  const stack: Frame<N, L>[] = [];
  const below = (node: N): number =>
    isObject(node) ? (depthBelow?.get(node) ?? 0) : 0;
  const routesThrough = (routes: ReadonlyArray<number>, step: string, at: number) => {
    if (routes.length === 0) return NO_ROUTES;
    const out: number[] = [];
    for (const r of routes) {
      const route = highlightRoutes[r];
      if (at < route.length && route[at] === step) out.push(r);
    }
    return out.length === 0 ? NO_ROUTES : out;
  };
  /** Whether a route ends here: the node keeps a row of its own. */
  const isTarget = (routes: ReadonlyArray<number>, at: number) =>
    routes.some((r) => highlightRoutes[r].length === at);
  /** Whether a highlighting route ends here. */
  const isMarked = (routes: ReadonlyArray<number>, at: number) =>
    routes.some((r) => r < unmarkedRoutesFrom && highlightRoutes[r].length === at);
  const allRoutes: ReadonlyArray<number> = highlightRoutes.map((_, i) => i);

  /**
   * Emit the row for `node`, folding a single-child run when configured. Returns false when the row budget is spent.
   */
  const emit = (
    node: N,
    path: string,
    key: string | number | null,
    isArrayItem: boolean,
    label: L | undefined,
    depth: number,
    dataDepth: number,
    routes: ReadonlyArray<number>,
    chainOpen: boolean,
  ): boolean => {
    if (rows.length >= limit) return false;

    const container = isObject(node) && adapter.isContainer(node);
    if (!container) {
      rows.push({
        path, foldStartPath: path, foldStartNode: node, node, depth, dataDepth, key, isArrayItem, label,
        kind: "leaf", childCount: 0,
        isHighlighted: isMarked(routes, dataDepth),
        onHighlightRoute: false, fold: null, depthBelow: 0,
      });
      return true;
    }

    // Walk the single-child run this node starts, keeping the last node.
    const foldKeys: (string | number)[] = [];
    let at = { node, path, key, isArrayItem, label, dataDepth, routes, chainOpen };
    let children = adapter.childrenOf(at.node);
    let open = isOpen({
      path: at.path, node: at.node, depth: at.dataDepth,
      onHighlightRoute: at.routes.length > 0 && !isTarget(at.routes, at.dataDepth),
      chainOpen: at.chainOpen,
    });
    for (;;) {
      if (foldChainsFrom === Infinity) break;
      if (!open || children.length !== 1) break;
      // A highlighted node keeps its own row: neither absorbed into a run
      // above it nor standing for one below it.
      if (isTarget(at.routes, at.dataDepth)) break;
      const only = children[0];
      if (!isObject(only.node) || !adapter.isContainer(only.node)) break;
      const onlyRoutes = routesThrough(at.routes, adapter.stepOf(only), at.dataDepth);
      if (isTarget(onlyRoutes, at.dataDepth + 1)) break;
      const onlyChain = at.chainOpen || (opensChain && open);
      const onlyPath = adapter.childPath(at.path, only);
      const onlyOpen = isOpen({
        path: onlyPath, node: only.node, depth: at.dataDepth + 1,
        onHighlightRoute: onlyRoutes.length > 0,
        chainOpen: onlyChain,
      });
      foldKeys.push(at.key ?? "");
      at = {
        node: only.node, path: onlyPath, key: only.key, isArrayItem: only.isArrayItem,
        label: only.label, dataDepth: at.dataDepth + 1, routes: onlyRoutes, chainOpen: onlyChain,
      };
      children = adapter.childrenOf(at.node);
      open = onlyOpen;
    }
    // A run shorter than the threshold is shown level by level after all.
    if (foldKeys.length > 0 && foldKeys.length + 1 < foldChainsFrom) {
      at = { node, path, key, isArrayItem, label, dataDepth, routes, chainOpen };
      children = adapter.childrenOf(node);
      open = isOpen({
        path, node, depth: dataDepth,
        onHighlightRoute: routes.length > 0 && !isTarget(routes, dataDepth),
        chainOpen,
      });
      foldKeys.length = 0;
    }

    const fold: FlatFold | null =
      foldKeys.length > 0 ? { levels: foldKeys.length + 1, keys: [...foldKeys, at.key ?? ""] } : null;
    const target = isTarget(at.routes, at.dataDepth);
    rows.push({
      path: at.path, foldStartPath: path, foldStartNode: node, node: at.node, depth, dataDepth: at.dataDepth,
      key: at.key, isArrayItem: at.isArrayItem, label: at.label,
      kind: open ? "open" : "closed", childCount: children.length,
      isHighlighted: target && isMarked(at.routes, at.dataDepth),
      onHighlightRoute: open && at.routes.length > 0 && !target,
      fold, depthBelow: below(at.node),
    });
    if (!open) return true;

    stack.push({
      path: at.path, node: at.node, children, next: 0,
      childDepth: depth + 1, childDataDepth: at.dataDepth + 1,
      routes: at.routes,
      chainOpen: at.chainOpen || (opensChain && children.length === 1),
      closing: closingRows
        ? {
            path: at.path, foldStartPath: path, foldStartNode: node, node: at.node, depth, dataDepth: at.dataDepth,
            key: at.key, isArrayItem: at.isArrayItem, label: at.label,
            kind: "closing", childCount: children.length,
            isHighlighted: false, onHighlightRoute: false, fold, depthBelow: below(at.node),
          }
        : null,
    });
    return true;
  };

  let truncated = false;
  if (skipRoot && isObject(root) && adapter.isContainer(root)) {
    const children = adapter.childrenOf(root);
    stack.push({
      path: rootPath, node: root, children, next: 0,
      childDepth: 0, childDataDepth: 1, routes: allRoutes,
      chainOpen: false, closing: null,
    });
  } else if (!emit(root, rootPath, null, false, undefined, 0, 0, allRoutes, false)) {
    truncated = true;
  }

  while (stack.length > 0 && !truncated) {
    const frame = stack[stack.length - 1];
    if (frame.next >= frame.children.length) {
      stack.pop();
      if (frame.closing) {
        if (rows.length >= limit) {
          truncated = true;
          break;
        }
        rows.push(frame.closing);
      }
      continue;
    }
    const child = frame.children[frame.next++];
    const routes = routesThrough(frame.routes, adapter.stepOf(child), frame.childDataDepth - 1);
    const chainOpen = frame.chainOpen && frame.children.length === 1;
    if (
      !emit(
        child.node, adapter.childPath(frame.path, child), child.key, child.isArrayItem,
        child.label, frame.childDepth, frame.childDataDepth, routes, chainOpen,
      )
    ) {
      truncated = true;
    }
  }

  return { rows, truncated };
}
