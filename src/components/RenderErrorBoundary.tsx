"use client";

import { Component, type ReactNode } from "react";

export interface RenderErrorBoundaryProps {
  children?: ReactNode;
  /** Names what could not be shown, e.g. "the validation result". */
  what: string;
  /**
   * "inline": a one-line note in place of one formatted value.
   * "panel": a block with a "Try again" button in place of a whole panel.
   */
  variant?: "inline" | "panel";
  /** A change in any of these (compared with Object.is) clears a caught error. */
  resetKeys?: readonly unknown[];
}

interface RenderErrorBoundaryState {
  error: Error | null;
}

function keysChanged(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  if (a === b) return false;
  if (!a || !b || a.length !== b.length) return true;
  return a.some((value, i) => !Object.is(value, b[i]));
}

/**
 * Keeps a render failure inside the subtree it happened in: the subtree is
 * replaced by a short error note and the rest of the page stays mounted, so
 * the user's input and tab state survive. React itself reports the caught
 * error (console, or the root's onCaughtError).
 */
export class RenderErrorBoundary extends Component<RenderErrorBoundaryProps, RenderErrorBoundaryState> {
  state: RenderErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): RenderErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidUpdate(prevProps: RenderErrorBoundaryProps, prevState: RenderErrorBoundaryState): void {
    // Skip the update that caught the error: its resetKeys may be the very
    // change that caused it, and clearing now would re-render the failing tree.
    if (
      this.state.error !== null &&
      prevState.error !== null &&
      keysChanged(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    const detail = error.message || error.name;
    if (this.props.variant === "panel") {
      return (
        <div className="render-error-panel" role="alert">
          <div className="render-error-panel-title">Could not display {this.props.what}.</div>
          <div className="render-error-panel-detail">{detail}</div>
          <button type="button" className="render-error-panel-retry" onClick={this.reset}>
            Try again
          </button>
        </div>
      );
    }
    return (
      <span className="render-error-inline" role="alert">
        Could not display {this.props.what}: {detail}
      </span>
    );
  }
}
