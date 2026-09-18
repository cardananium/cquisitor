"use client";

// Four docked panels: tabs in groups, drag onto any edge, one group maximisable.
// Docking is the library's; we own contents, tab extras, persistence, and presets.
// Each body is rendered once into the library's element, which moves with the panel.

import "dockview/dist/styles/dockview.css";

import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  DockviewReact,
  themeLightSpaced,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import {
  ALL_PANELS,
  DEFAULT_PRESET,
  NO_MOVE_TARGET_REASON,
  PANEL_COMPONENT,
  PANEL_NAMES,
  applyPreset,
  browserStorage,
  groupMenuModel,
  isPanelId,
  presetOf,
  readStoredLayout,
  writeStoredLayout,
  type GroupMenuModel,
  type PanelId,
  type PresetId,
} from "./workspaceLayout";

export interface PanelSpec {
  /** Header controls beside the tabs while this panel is active. Direct children of the strip action area; a `.cq-flex-grow` spacer among them right-aligns the rest. */
  extras: ReactNode;
  /** Pinned-instance chip, when a pin is active. */
  nav: ReactNode;
  body: ReactNode;
}
export type PanelRegistry = Record<PanelId, PanelSpec>;

export interface DockWorkspaceHandle {
  /** Bring `panel` to the front of its group. */
  activate(panel: PanelId): void;
}

export interface DockWorkspaceProps {
  panels: PanelRegistry;
  /** Each group's active tab, whenever that set changes. */
  onVisibleChange: (visible: ReadonlySet<PanelId>) => void;
}

interface WorkspaceContextValue {
  panels: PanelRegistry;
  /** Preset matching the current arrangement, or null if custom. */
  preset: PresetId | null;
  choosePreset: (id: PresetId) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const THEME: DockviewTheme = {
  ...themeLightSpaced,
  name: "cquisitor",
  className: "dockview-theme-light-spaced cq-dock-theme",
  gap: 8,
};

function panelIdsOf(group: { panels: readonly { id: string }[] }): PanelId[] {
  return group.panels.map(p => p.id).filter(isPanelId);
}

/** Panel body from the workspace registry. */
function PanelBody({ api }: IDockviewPanelProps): ReactElement | null {
  const ctx = useContext(WorkspaceContext);
  if (!ctx || !isPanelId(api.id)) return null;
  return <div className={`cq-panel-body cq-panel-body-${api.id}`}>{ctx.panels[api.id].body}</div>;
}

/** Tab label with no close control — panels can only be moved. */
function PanelTab({ api }: IDockviewPanelHeaderProps): ReactElement {
  return <span className="cq-dock-tab">{isPanelId(api.id) ? PANEL_NAMES[api.id] : api.title}</span>;
}

/** Active panel extras, pin chip, and ⋮ menu, to the right of the group's tabs. */
function GroupActions({ activePanel, group, containerApi }: IDockviewHeaderActionsProps): ReactElement | null {
  const ctx = useContext(WorkspaceContext);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ left: number; top: number } | null>(null);
  const closeMenu = useCallback(() => {
    setMenuAt(null);
    buttonRef.current?.focus();
  }, []);
  if (!ctx || !activePanel || !isPanelId(activePanel.id)) return null;
  const panel = activePanel.id;
  const spec = ctx.panels[panel];
  const model = menuAt
    ? groupMenuModel(
      panel,
      containerApi.groups.map(g => ({ id: g.id, panels: panelIdsOf(g) })),
      ctx.preset,
      group.api.isMaximized(),
    )
    : null;
  return (
    <div className="cq-strip-actions">
      {spec.extras}
      <div className="cq-strip-trailing">
        {spec.nav}
        <button
          ref={buttonRef}
          type="button"
          className="cq-group-menu-btn"
          aria-label="Panel menu"
          aria-haspopup="menu"
          aria-expanded={menuAt !== null}
          onClick={(e) => {
            if (menuAt) {
              setMenuAt(null);
              return;
            }
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt({ left: r.right - 210, top: r.bottom + 4 });
          }}
        >
          ⋮
        </button>
      </div>
      {menuAt && model && (
        <GroupMenu
          model={model}
          position={menuAt}
          onClose={closeMenu}
          onMove={(groupId) => {
            const target = containerApi.getGroup(groupId);
            if (target) activePanel.api.moveTo({ group: target as never, position: "center" });
          }}
          onSplit={(position) => activePanel.api.moveTo({ group: group, position })}
          onMaximize={() => (group.api.isMaximized() ? group.api.exitMaximized() : group.api.maximize())}
          onPreset={ctx.choosePreset}
        />
      )}
    </div>
  );
}

export interface GroupMenuProps {
  model: GroupMenuModel;
  position: { left: number; top: number };
  onClose: () => void;
  onMove: (groupId: string) => void;
  onSplit: (position: "right" | "bottom") => void;
  onMaximize: () => void;
  onPreset: (id: PresetId) => void;
}

/** Move the active panel, or switch layout. */
export function GroupMenu({ model, position, onClose, onMove, onSplit, onMaximize, onPreset }: GroupMenuProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape. preventDefault so another sheet does not close on the same keystroke.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  // Keep the menu in the viewport and focus the first enabled item.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw - 8) el.style.left = `${Math.max(8, vw - rect.width - 8)}px`;
    if (rect.left < 8) el.style.left = "8px";
    if (rect.bottom > vh - 8) el.style.top = `${Math.max(8, vh - rect.height - 8)}px`;
    el.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus();
  }, [position]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const items = Array.from(el.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)'));
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
  };

  const act = (run: () => void) => {
    run();
    onClose();
  };
  const item = (label: string, run: () => void, state: { enabled: boolean; reason: string | null }, key?: string) => (
    <button
      key={key ?? label}
      type="button"
      role="menuitem"
      className="cq-group-menu-item"
      disabled={!state.enabled}
      title={state.enabled ? undefined : state.reason ?? undefined}
      onClick={() => act(run)}
    >
      {label}
    </button>
  );
  const enabled = { enabled: true, reason: null };

  return (
    <div
      ref={ref}
      className="cq-group-menu"
      role="menu"
      aria-label={`Panel menu for ${model.panelName}`}
      style={{ left: position.left, top: position.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="cq-group-menu-section">Move to</div>
      {model.moveTargets.length === 0
        ? item("No other group", () => {}, { enabled: false, reason: NO_MOVE_TARGET_REASON })
        : model.moveTargets.map(t => item(t.name, () => onMove(t.groupId), enabled, `move-${t.groupId}`))}
      <div className="cq-group-menu-separator" />
      {item("Split right", () => onSplit("right"), model.splitRight)}
      {item("Split below", () => onSplit("bottom"), model.splitBelow)}
      {item(model.maximized ? "Restore size" : "Maximize", onMaximize, enabled)}
      <div className="cq-group-menu-separator" />
      <div className="cq-group-menu-section">Layout</div>
      {model.presets.map(p => (
        <button
          key={p.id}
          type="button"
          role="menuitemradio"
          aria-checked={p.current}
          className="cq-group-menu-item"
          onClick={() => act(() => onPreset(p.id))}
        >
          <span className="cq-group-menu-check">{p.current ? "✓" : ""}</span>
          {p.name}
        </button>
      ))}
      <div className="cq-group-menu-separator" />
      {item("Reset layout", () => onPreset(DEFAULT_PRESET), model.reset)}
    </div>
  );
}

const COMPONENTS = { [PANEL_COMPONENT]: PanelBody };

/** Each group's active tab. */
function visiblePanels(api: DockviewApi): Set<PanelId> {
  const out = new Set<PanelId>();
  for (const p of api.panels) if (p.api.isVisible && isPanelId(p.id)) out.add(p.id);
  return out;
}

const sameSet = (a: ReadonlySet<PanelId>, b: ReadonlySet<PanelId>) =>
  a.size === b.size && [...a].every(p => b.has(p));

const DockWorkspace = forwardRef<DockWorkspaceHandle, DockWorkspaceProps>(function DockWorkspace(
  { panels, onVisibleChange },
  ref,
) {
  const apiRef = useRef<DockviewApi | null>(null);
  const [preset, setPreset] = useState<PresetId | null>(null);
  const visibleRef = useRef<ReadonlySet<PanelId>>(new Set());

  const publishVisible = useCallback((api: DockviewApi) => {
    const next = visiblePanels(api);
    if (sameSet(next, visibleRef.current)) return;
    visibleRef.current = next;
    onVisibleChange(next);
  }, [onVisibleChange]);

  const choosePreset = useCallback((id: PresetId) => {
    const api = apiRef.current;
    if (!api) return;
    applyPreset(api, id);
  }, []);

  useImperativeHandle(ref, () => ({
    activate(panel) {
      apiRef.current?.getPanel(panel)?.api.setActive();
    },
  }), []);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api;
    apiRef.current = api;
    const storage = browserStorage();
    // Last layout, or the default if the library rejects the stored record.
    const stored = readStoredLayout(storage);
    let restored = false;
    if (stored) {
      try {
        api.fromJSON(stored);
        restored = ALL_PANELS.every(p => api.getPanel(p) !== undefined);
      } catch {
        restored = false;
      }
    }
    if (!restored) applyPreset(api, DEFAULT_PRESET);
    const settle = () => {
      const json = api.toJSON();
      writeStoredLayout(storage, json);
      setPreset(presetOf(json));
      publishVisible(api);
    };
    settle();
    // Maximized state is stored, but only this event reports it changing.
    const subscriptions = [
      api.onDidLayoutChange(settle),
      api.onDidMaximizedGroupChange(settle),
      api.onDidActivePanelChange(() => publishVisible(api)),
    ];
    return () => {
      for (const s of subscriptions) s.dispose();
    };
  }, [publishVisible]);

  // Dockview does not call the disposer `onReady` returns; we run it on unmount.
  const disposeRef = useRef<(() => void) | null>(null);
  const ready = useCallback((event: DockviewReadyEvent) => {
    disposeRef.current?.();
    disposeRef.current = onReady(event);
  }, [onReady]);
  useEffect(() => () => {
    disposeRef.current?.();
    disposeRef.current = null;
  }, []);

  const ctx = useMemo<WorkspaceContextValue>(
    () => ({ panels, preset, choosePreset }),
    [panels, preset, choosePreset],
  );

  return (
    <WorkspaceContext.Provider value={ctx}>
      <DockviewReact
        className="cq-dock"
        theme={THEME}
        components={COMPONENTS}
        defaultTabComponent={PanelTab}
        rightHeaderActionsComponent={GroupActions}
        onReady={ready}
        disableFloatingGroups
        singleTabMode="default"
      />
    </WorkspaceContext.Provider>
  );
});

export default DockWorkspace;
