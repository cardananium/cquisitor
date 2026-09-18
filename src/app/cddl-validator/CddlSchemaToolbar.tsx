"use client";

import type { ReactNode } from "react";
import CddlRulePicker, { NO_ROOT_RULE_NOTE } from "./CddlRulePicker";
import { CARDANO_PRESETS, LEDGER_REV_SHORT } from "./presets";

/** Preset currently in the editor, and whether the text still matches it. */
export interface ActivePreset {
  id: string;
  label: string;
  edited: boolean;
}

interface CddlSchemaToolbarProps {
  ruleNames: string[];
  /** Rule validation runs against (the pick, or its fallback). */
  effectiveRule: string;
  /** Picker text; only visibly different while typed. */
  selectedRule: string;
  /** Rule list is from the last schema that parsed. */
  ruleNamesAreStale?: boolean;
  /** Schema currently checks. Combined with empty `ruleNames`, none of the declared rules can be a root. */
  schemaIsValid?: boolean;
  onRulePick: (rule: string) => void;
  presetLoading: string | null;
  /** Preset the schema came from, so the picker can name it. */
  activePreset: ActivePreset | null;
  onLoadPreset: (id: string) => void;
  onFormat?: () => void;
  formatDisabled?: boolean;
  /** Last whole-schema replacement ("format", "clear", …). Absent when there is nothing to undo. */
  undoLabel?: string;
  onUndoReplace?: () => void;
  /** Right-aligned slot — compact offer of another root when the document was refused at `$`. */
  rightSlot?: ReactNode;
}

export default function CddlSchemaToolbar({
  ruleNames,
  effectiveRule,
  selectedRule,
  ruleNamesAreStale,
  schemaIsValid = false,
  onRulePick,
  presetLoading,
  activePreset,
  onLoadPreset,
  onFormat,
  formatDisabled,
  undoLabel,
  onUndoReplace,
  rightSlot,
}: CddlSchemaToolbarProps) {
  // An era is the selected option only while the editor still holds it unchanged.
  // After an edit or while another load is in flight, the placeholder is selected so re-picking reloads.
  const selectedPresetId =
    presetLoading || !activePreset || activePreset.edited ? "" : activePreset.id;
  const placeholder = presetLoading
    ? `loading ${presetLoading}…`
    : activePreset
      ? `${activePreset.label} (edited)`
      : "load preset…";
  const noRoot = schemaIsValid && ruleNames.length === 0;

  return (
    <div className="cddl-toolbar-row">
      <div className="cddl-rule-picker">
        <label className="cddl-rule-picker-label">rule</label>
        <CddlRulePicker
          ruleNames={ruleNames}
          rule={effectiveRule}
          typedRule={selectedRule}
          onPick={onRulePick}
          stale={ruleNamesAreStale}
          noRoot={noRoot}
        />
      </div>

      <div className="cddl-preset-picker">
        <label className="cddl-rule-picker-label">cardano</label>
        <select
          className="cddl-rule-picker-select"
          value={selectedPresetId}
          disabled={presetLoading !== null}
          onChange={(e) => {
            const id = e.target.value;
            // Reset the select if the load is declined or fails (no re-render otherwise).
            e.target.value = selectedPresetId;
            if (id) onLoadPreset(id);
          }}
          title={`Cardano CDDL from IntersectMBO/cardano-ledger, pinned to ${LEDGER_REV_SHORT}`}
        >
          <option value="">{placeholder}</option>
          {CARDANO_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.bundled ? `${p.label} (bundled)` : p.label}
            </option>
          ))}
        </select>
      </div>

      {onFormat && (
        <button
          type="button"
          className="cq-toolbar-btn"
          onClick={onFormat}
          disabled={formatDisabled}
          title={
            formatDisabled
              ? "Format unavailable while CDDL has errors"
              : "Reformat CDDL — comments inside a rule are dropped"
          }
        >Format</button>
      )}

      {undoLabel && onUndoReplace && (
        <button
          type="button"
          className="cq-toolbar-btn"
          onClick={onUndoReplace}
          title={`Restore the schema as it was before the ${undoLabel}`}
        >Undo {undoLabel}</button>
      )}

      {rightSlot && (
        <>
          <div className="cq-flex-grow" />
          {rightSlot}
        </>
      )}

      {/* Own row under the controls so the picker stays in place. */}
      {noRoot && (
        <span className="cddl-toolbar-note" role="status">{NO_ROOT_RULE_NOTE}</span>
      )}
    </div>
  );
}
