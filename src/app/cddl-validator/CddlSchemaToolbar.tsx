"use client";

import type { ReactNode } from "react";
import { CARDANO_PRESETS } from "./presets";

interface CddlSchemaToolbarProps {
  ruleNames: string[];
  selectedRule: string;
  onRulePick: (rule: string) => void;
  presetLoading: string | null;
  onLoadPreset: (id: string) => void;
  /** Right-aligned slot — used for the error nav when there are errors. */
  rightSlot?: ReactNode;
}

export default function CddlSchemaToolbar({
  ruleNames,
  selectedRule,
  onRulePick,
  presetLoading,
  onLoadPreset,
  rightSlot,
}: CddlSchemaToolbarProps) {
  return (
    <div className="cddl-toolbar-row">
      <div className="cddl-rule-picker">
        <label className="cddl-rule-picker-label">rule</label>
        {ruleNames.length > 0 ? (
          <select
            className="cddl-rule-picker-select cddl-rule-name-select"
            value={ruleNames.includes(selectedRule) ? selectedRule : ""}
            onChange={(e) => onRulePick(e.target.value)}
            title={ruleNames.includes(selectedRule) ? selectedRule : undefined}
          >
            {!ruleNames.includes(selectedRule) && <option value="">—</option>}
            {ruleNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            className="cddl-rule-picker-input"
            value={selectedRule}
            onChange={(e) => onRulePick(e.target.value)}
            placeholder="root rule"
          />
        )}
      </div>

      <div className="cddl-preset-picker">
        <label className="cddl-rule-picker-label">cardano</label>
        <select
          className="cddl-rule-picker-select"
          value=""
          disabled={presetLoading !== null}
          onChange={(e) => {
            const id = e.target.value;
            e.target.value = "";
            onLoadPreset(id);
          }}
          title="Load a Cardano CDDL preset from IntersectMBO/cardano-ledger"
        >
          <option value="">{presetLoading ? `loading ${presetLoading}…` : "load preset…"}</option>
          {CARDANO_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>

      {rightSlot && (
        <>
          <div className="cq-flex-grow" />
          {rightSlot}
        </>
      )}
    </div>
  );
}
