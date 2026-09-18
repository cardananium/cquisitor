/** One action a panel contributes to a host-owned context menu (panels do not render their own). */
export interface PanelMenuAction {
  /** Stable key for rendering. */
  id: string;
  label: string;
  run: () => void;
}
