"use client";

// Renders a UTxO sitting at a SundaeSwap V4 address: an order, a pool, the
// global settings node, or one of the token-bound settings nodes.
//
// The thing to show about a V4 order is its CONSTRAINTS. The datum itself says
// only who owns the order, where it pays out, and what it will pay in fees —
// what the order actually asks for lives in a list keyed by the script hash of
// the validator that enforces it. So the panel leads with the resolved
// constraints and names each one by its validator, because that hash is the
// only thing that says what the order means.

import React from "react";
import { HashWithTooltip } from "./HashWithTooltip";
import { V4AssetList, V4AssetName, V4AssetValue, V4FlowSummary, V4PoolMintContext } from "./SundaeV4Asset";
import { formatAda, truncateHash } from "../utils";
import {
  isSupersededTitle,
  lpAssetFor,
  poolNftFor,
  type SundaeOutputDetection,
  type V4ActionEntry,
  type V4DecodedConstraint,
  type V4Destination,
  type V4OrderDatum,
  type V4PoolDatum,
  type V4SettingsDatum,
  type V4SettingsNode,
  type V3Multisig,
} from "@/utils/protocols/sundae";

interface SundaeV4OrderPanelProps {
  detection: SundaeOutputDetection;
  /** Pool mint policy for the matched deployment, for naming LP tokens. */
  poolMintPolicy?: string | null;
}

// --- Shared bits ----------------------------------------------------------

/** A `MultisigScript`, flattened to one row per leaf. */
function MultisigRows({ label, script }: { label: string; script: V3Multisig }) {
  const rows = flattenMultisig(script, label);
  return (
    <>
      {rows.map((row, i) => (
        <div className="tcv-sundae-row" key={i}>
          <span className="tcv-sundae-leg-label">{row.label}</span>
          {row.hash ? (
            <span className="tcv-sundae-mono">
              <HashWithTooltip hash={row.hash} />
            </span>
          ) : (
            <span>{row.text}</span>
          )}
        </div>
      ))}
    </>
  );
}

function flattenMultisig(
  script: V3Multisig,
  label: string,
): Array<{ label: string; hash?: string; text?: string }> {
  switch (script.kind) {
    case "Signature":
      return [{ label, hash: script.keyHash }];
    case "Script":
      return [{ label: `${label} (script)`, hash: script.scriptHash }];
    case "Before":
      return [{ label: `${label} (before)`, text: `${script.time} ms` }];
    case "After":
      return [{ label: `${label} (after)`, text: `${script.time} ms` }];
    case "AllOf":
    case "AnyOf":
      return [
        {
          label: `${label} (${script.kind === "AllOf" ? "all of" : "any of"})`,
          text: `${script.scripts.length} signer${script.scripts.length === 1 ? "" : "s"}`,
        },
        ...script.scripts.flatMap((s, i) => flattenMultisig(s, `${label} #${i + 1}`)),
      ];
    case "AtLeast":
      return [
        {
          label: `${label} (at least)`,
          text: `${script.required} of ${script.scripts.length}`,
        },
        ...script.scripts.flatMap((s, i) => flattenMultisig(s, `${label} #${i + 1}`)),
      ];
  }
}

function DestinationRows({ destination }: { destination: V4Destination }) {
  if (destination.kind === "Self") {
    return (
      <div className="tcv-sundae-row">
        <span className="tcv-sundae-leg-label">Destination</span>
        <span className="tcv-sundae-self">
          Self — the order re-locks at its own address
        </span>
      </div>
    );
  }
  const { paymentCredential: payment, stakeCredential: stake } = destination.address;
  return (
    <>
      <div className="tcv-sundae-row">
        <span className="tcv-sundae-leg-label">Pays out to</span>
        <span className="tcv-sundae-mono">
          {payment.kind === "VKey" ? "key " : "script "}
          <HashWithTooltip hash={payment.hash} />
        </span>
      </div>
      {stake?.kind === "Inline" && (
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Stake</span>
          <span className="tcv-sundae-mono">
            {stake.credential.kind === "VKey" ? "key " : "script "}
            <HashWithTooltip hash={stake.credential.hash} />
          </span>
        </div>
      )}
      {stake?.kind === "Pointer" && (
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Stake</span>
          <span className="tcv-sundae-mono">
            pointer ({stake.slotNumber}, {stake.transactionIndex}, {stake.certificateIndex})
          </span>
        </div>
      )}
      <div className="tcv-sundae-row">
        <span className="tcv-sundae-leg-label">Payout datum</span>
        <span className={destination.datum ? "" : "tcv-sundae-estimate-dim"}>
          {destination.datum ? "inline datum attached" : "none"}
        </span>
      </div>
    </>
  );
}

// --- Constraints ----------------------------------------------------------

function ConstraintBody({ constraint }: { constraint: V4DecodedConstraint }) {
  const { body } = constraint;
  switch (body.kind) {
    case "basic":
      return (
        <>
          {body.subtype === null && (
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">Subtype</span>
              <span className="tcv-sundae-estimate-dim">
                constructor {body.subtypeTag} is not one of the four known subtypes
              </span>
            </div>
          )}
          <V4AssetList entries={body.offered} label="Offered" />
          <V4AssetList entries={body.minReceived} label="Min received" />
        </>
      );
    case "swap":
      return (
        <>
          <div className="tcv-sundae-row">
            <span className="tcv-sundae-leg-label">Offering</span>
            <V4AssetValue asset={body.offered} amount={body.remainingOffered} />
            {body.remainingOffered !== body.originalOffered && (
              <span className="tcv-sundae-estimate-dim">
                remaining of {body.originalOffered.toLocaleString()} originally offered
              </span>
            )}
          </div>
          <V4AssetList entries={body.minReceived} label="Min received" />
          {body.remainingOffered !== body.originalOffered && (
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">Filled</span>
              <span className="tcv-sundae-estimate-dim">
                {fillPercent(body.originalOffered, body.remainingOffered)} of the original
                amount has been filled
              </span>
            </div>
          )}
        </>
      );
    case "strategy":
      return (
        <>
          <MultisigRows label="Authorized by" script={body.auth} />
          <div className="tcv-sundae-row">
            <span className="tcv-sundae-leg-label">Destinations</span>
            <span className="tcv-sundae-estimate-dim">
              {body.finalDestinations.length === 0
                ? "the order's own destination only"
                : `${body.finalDestinations.length} signed alternative${
                    body.finalDestinations.length === 1 ? "" : "s"
                  }`}
            </span>
          </div>
        </>
      );
    case "route":
      return (
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Pools</span>
          <span className="tcv-sundae-estimate-dim">
            {body.poolWhitelist.length === 0
              ? "any pool may serve this route"
              : `${body.poolWhitelist.length} whitelisted pool${
                  body.poolWhitelist.length === 1 ? "" : "s"
                }`}
          </span>
        </div>
      );
    case "fee":
      return (
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-estimate-dim">
            Pins the fee each scoop deducts to the protocol&apos;s base fee.
          </span>
        </div>
      );
    case "fairness":
      return (
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-estimate-dim">
            Constrains the order&apos;s position within the batch.
          </span>
        </div>
      );
    case "unknown":
      return (
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Not decoded</span>
          <span className="tcv-sundae-estimate-dim">{body.reason}</span>
        </div>
      );
  }
}

function fillPercent(original: bigint, remaining: bigint): string {
  if (original <= BigInt(0)) return "—";
  const filled = original - remaining;
  const pct = Number((filled * BigInt(10000)) / original) / 100;
  return `${pct.toFixed(2)}%`;
}

function ConstraintCard({ constraint }: { constraint: V4DecodedConstraint }) {
  return (
    <div className="tcv-sundae-v4-constraint">
      <div className="tcv-sundae-v4-constraint-head">
        <span className="tcv-sundae-v4-constraint-name">{constraint.label}</span>
        {constraint.title && isSupersededTitle(constraint.title) && (
          <span className="tcv-sundae-status warning">superseded deployment</span>
        )}
        <span className="tcv-sundae-v4-constraint-hash" title={constraint.hash}>
          <HashWithTooltip hash={constraint.hash} />
        </span>
      </div>
      <ConstraintBody constraint={constraint} />
    </div>
  );
}

// --- Order ----------------------------------------------------------------

function OrderBody({
  datum,
  constraints,
}: {
  datum: V4OrderDatum;
  constraints: V4DecodedConstraint[];
}) {
  const action = constraints.filter(
    (c) => c.body.kind !== "fee" && c.body.kind !== "fairness",
  );
  const modifiers = constraints.filter(
    (c) => c.body.kind === "fee" || c.body.kind === "fairness",
  );

  return (
    <>
      <div className="tcv-sundae-section">
        {constraints.length === 0 ? (
          <div className="tcv-sundae-row">
            <span className="tcv-sundae-estimate-dim">
              This order carries no constraints, so nothing bounds what a scoop may
              take from it.
            </span>
          </div>
        ) : (
          <>
            {action.map((c) => (
              <ConstraintCard key={c.hash} constraint={c} />
            ))}
            {modifiers.map((c) => (
              <ConstraintCard key={c.hash} constraint={c} />
            ))}
          </>
        )}
      </div>

      <div className="tcv-sundae-section tcv-sundae-meta">
        <MultisigRows label="Owner" script={datum.owner} />
        <DestinationRows destination={datum.destination} />
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Service budget</span>
          <span className="tcv-ada-amount">
            ₳ {formatAda(datum.serviceBudget.toString())}
          </span>
          <span className="tcv-sundae-estimate-dim">
            remaining lifetime allowance for scoop fees
          </span>
        </div>
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Max per scoop</span>
          <span className="tcv-ada-amount">
            ₳ {formatAda(datum.maxPerExecution.toString())}
          </span>
          <span className="tcv-sundae-estimate-dim">
            flat cap on one execution, whatever its step count
          </span>
        </div>
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Order type</span>
          <span className="tcv-sundae-mono">
            <HashWithTooltip hash={datum.configToken} />
          </span>
          <span className="tcv-sundae-estimate-dim">config token</span>
        </div>
      </div>
    </>
  );
}

// --- Pool -----------------------------------------------------------------

function ActionRow({
  action,
  moduleLabels,
}: {
  action: V4ActionEntry;
  moduleLabels: Map<string, string>;
}) {
  return (
    <div className="tcv-sundae-row">
      <span className="tcv-sundae-leg-label">Tag {String(action.tag)}</span>
      <span className={action.enabled ? "tcv-sundae-status ok" : "tcv-sundae-status warning"}>
        {action.enabled ? "enabled" : "disabled"}
      </span>
      <span className="tcv-sundae-v4-modules">
        {action.modules.map((hash) => (
          <span className="tcv-sundae-v4-module" key={hash} title={hash}>
            {moduleLabels.get(hash) ?? truncateHash(hash, 8, 4)}
          </span>
        ))}
      </span>
    </div>
  );
}

function PoolBody({
  datum,
  poolMintPolicy,
  moduleLabels,
}: {
  datum: V4PoolDatum;
  poolMintPolicy?: string | null;
  moduleLabels: Map<string, string>;
}) {
  const lpAsset = poolMintPolicy ? lpAssetFor(poolMintPolicy, datum.identifier) : null;
  const nft = poolMintPolicy ? poolNftFor(poolMintPolicy, datum.identifier) : null;
  // total − circulating is the protocol's own position, grown by the fee split
  // without minting tokens.
  const phantomLp = datum.totalLp - datum.circulatingLp;

  return (
    <>
      <div className="tcv-sundae-section">
        <V4AssetList entries={datum.assets} label="Reserves" />
      </div>

      <div className="tcv-sundae-section tcv-sundae-meta">
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Pool ident</span>
          <span className="tcv-sundae-mono">
            <HashWithTooltip hash={datum.identifier} />
          </span>
        </div>
        {nft && (
          <div className="tcv-sundae-row">
            <span className="tcv-sundae-leg-label">Pool NFT</span>
            <V4AssetName asset={nft} className="tcv-sundae-mono" />
          </div>
        )}
        {lpAsset && (
          <div className="tcv-sundae-row">
            <span className="tcv-sundae-leg-label">LP token</span>
            <V4AssetName asset={lpAsset} className="tcv-sundae-mono" />
          </div>
        )}
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Circulating LP</span>
          <span className="tcv-sundae-asset-amount">
            {datum.circulatingLp.toLocaleString()}
          </span>
          <span className="tcv-sundae-estimate-dim">live claims on the reserves</span>
        </div>
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Total LP</span>
          <span className="tcv-sundae-asset-amount">{datum.totalLp.toLocaleString()}</span>
          {phantomLp !== BigInt(0) && (
            <span className="tcv-sundae-estimate-dim">
              {phantomLp > BigInt(0) ? "+" : "−"}
              {(phantomLp < BigInt(0) ? -phantomLp : phantomLp).toLocaleString()} phantom (the
              protocol&apos;s uncollected revenue)
            </span>
          )}
        </div>
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Preminted LP</span>
          <span className="tcv-sundae-asset-amount">
            {datum.premintedLp.toLocaleString()}
          </span>
          <span className="tcv-sundae-estimate-dim">
            inert transfer reserve held in the pool
          </span>
        </div>
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Min surplus</span>
          <span className="tcv-ada-amount">₳ {formatAda(datum.minSurplus.toString())}</span>
          <span className="tcv-sundae-estimate-dim">floor on the pool&apos;s lovelace</span>
        </div>
      </div>

      <div className="tcv-sundae-section">
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Actions</span>
          <span className="tcv-sundae-estimate-dim">
            {datum.actions.filter((a) => a.enabled).length} of {datum.actions.length}{" "}
            enabled
          </span>
        </div>
        {datum.actions.map((action) => (
          <ActionRow
            key={String(action.tag)}
            action={action}
            moduleLabels={moduleLabels}
          />
        ))}
      </div>

      {datum.moduleState.length > 0 && (
        <details className="tcv-sundae-v4-details">
          <summary>
            Module state · {datum.moduleState.length}{" "}
            {datum.moduleState.length === 1 ? "entry" : "entries"}
          </summary>
          <div className="tcv-sundae-section">
            {datum.moduleState.map((entry) => (
              <div className="tcv-sundae-row" key={entry.moduleHash}>
                <span className="tcv-sundae-leg-label">
                  {moduleLabels.get(entry.moduleHash) ?? truncateHash(entry.moduleHash, 8, 4)}
                </span>
                <span className="tcv-sundae-mono">
                  <HashWithTooltip hash={entry.state} />
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

// --- Settings -------------------------------------------------------------

function SettingsBody({ datum }: { datum: V4SettingsDatum }) {
  return (
    <div className="tcv-sundae-section tcv-sundae-meta">
      <MultisigRows label="Settings admin" script={datum.settingsAdmin} />
      <MultisigRows label="Treasury admin" script={datum.treasuryAdmin} />
      <MultisigRows label="Security council" script={datum.securityCouncil} />
      <div className="tcv-sundae-row">
        <span className="tcv-sundae-leg-label">Scoopers</span>
        <span>
          {datum.authorizedScoopers === null
            ? "open — anyone may scoop"
            : `${datum.authorizedScoopers.length} authorized`}
        </span>
      </div>
      {(datum.authorizedScoopers ?? []).map((scooper, i) => (
        <MultisigRows key={i} label={`Scooper #${i + 1}`} script={scooper} />
      ))}
    </div>
  );
}

function SettingsNodeBody({
  node,
  moduleLabels,
}: {
  node: V4SettingsNode;
  moduleLabels: Map<string, string>;
}) {
  if (node.kind === "FeeSettings") {
    return (
      <div className="tcv-sundae-section tcv-sundae-meta">
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Base fee</span>
          <span className="tcv-ada-amount">₳ {formatAda(node.baseFee.toString())}</span>
          <span className="tcv-sundae-estimate-dim">per scooped order</span>
        </div>
      </div>
    );
  }

  if (node.kind === "OrderConfig") {
    return (
      <div className="tcv-sundae-section tcv-sundae-meta">
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Config token</span>
          <span className="tcv-sundae-mono">
            <HashWithTooltip hash={node.label} />
          </span>
        </div>
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Requires</span>
          <span className="tcv-sundae-estimate-dim">
            {node.requiredConstraints.length} constraint
            {node.requiredConstraints.length === 1 ? "" : "s"}, all of which an order of
            this type must carry
          </span>
        </div>
        {node.requiredConstraints.map((hash) => (
          <div className="tcv-sundae-row" key={hash}>
            <span className="tcv-sundae-leg-label" />
            <span className="tcv-sundae-v4-module" title={hash}>
              {moduleLabels.get(hash) ?? truncateHash(hash, 8, 4)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="tcv-sundae-section tcv-sundae-meta">
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Pool validator</span>
          <span className="tcv-sundae-mono">
            <HashWithTooltip hash={node.poolValidator} />
          </span>
        </div>
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Min surplus</span>
          <span className="tcv-ada-amount">₳ {formatAda(node.minSurplus.toString())}</span>
        </div>
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Creation</span>
          <span>
            {node.mintPermission === null
              ? "permissionless"
              : "gated by a multisig"}
          </span>
        </div>
        {node.mintPermission && (
          <MultisigRows label="Gated by" script={node.mintPermission} />
        )}
      </div>
      <div className="tcv-sundae-section">
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Actions</span>
          <span className="tcv-sundae-estimate-dim">
            {node.actions.length} in this package
          </span>
        </div>
        {node.actions.map((action) => (
          <ActionRow
            key={String(action.tag)}
            action={action}
            moduleLabels={moduleLabels}
          />
        ))}
      </div>
    </>
  );
}

// --- Panel ----------------------------------------------------------------

function roleLabel(detection: SundaeOutputDetection): string {
  if (detection.v4Order) return "Order";
  if (detection.v4Pool) return "Pool";
  if (detection.v4Settings) return "Settings";
  if (detection.v4SettingsNode) {
    return detection.v4SettingsNode.kind === "PoolConfig"
      ? "Pool config"
      : detection.v4SettingsNode.kind === "OrderConfig"
        ? "Order config"
        : "Fee settings";
  }
  const role = detection.match.role;
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function SundaeV4OrderPanel({
  detection,
  poolMintPolicy,
}: SundaeV4OrderPanelProps) {
  // Every hash a pool or config references is a validator in the same
  // deployment, so one map names them all.
  const moduleLabels = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const c of detection.v4Order?.constraints ?? []) {
      if (c.title) map.set(c.hash, c.label);
    }
    return map;
  }, [detection.v4Order]);

  const kind = detection.v4Order
    ? orderKindLabel(detection.v4Order.constraints)
    : null;

  return (
    <V4PoolMintContext.Provider value={poolMintPolicy ?? null}>
    <div className="tcv-sundae-panel">
      <div className="tcv-sundae-banner">
        <span className="tcv-sundae-icon" aria-hidden>
          🍨
        </span>
        <span className="tcv-sundae-title">Sundae V4 {roleLabel(detection)}</span>
        <span className="tcv-sundae-script-hash">
          <HashWithTooltip hash={detection.match.hash} />
        </span>
      </div>

      {kind && (
        <div className="tcv-sundae-header-row">
          <span className="tcv-sundae-order-kind">{kind}</span>
        </div>
      )}

      {detection.v4Order ? (
        <OrderBody
          datum={detection.v4Order.datum}
          constraints={detection.v4Order.constraints}
        />
      ) : detection.v4Pool ? (
        <PoolBody
          datum={detection.v4Pool}
          poolMintPolicy={poolMintPolicy}
          moduleLabels={moduleLabels}
        />
      ) : detection.v4Settings ? (
        <SettingsBody datum={detection.v4Settings} />
      ) : detection.v4SettingsNode ? (
        <SettingsNodeBody node={detection.v4SettingsNode} moduleLabels={moduleLabels} />
      ) : detection.parseError ? (
        <div className="tcv-sundae-issues">
          <div className="tcv-sundae-issue tcv-sundae-issue-warning">
            <span className="tcv-sundae-issue-icon" aria-hidden>
              ⚠
            </span>
            <span>{detection.parseError}</span>
          </div>
        </div>
      ) : (
        <div className="tcv-sundae-section">
          <span className="tcv-sundae-estimate-dim">
            At a known V4 address, with no datum to read.
          </span>
        </div>
      )}
    </div>
    </V4PoolMintContext.Provider>
  );
}

/** Re-derived here so the panel does not need the scoop reconstruction. */
function orderKindLabel(constraints: V4DecodedConstraint[]): string {
  for (const c of constraints) {
    if (c.body.kind === "basic") {
      return c.body.subtype ?? "Order";
    }
    if (c.body.kind === "swap") return "Swap (partial fill)";
    if (c.body.kind === "strategy") return "Strategy";
    if (c.body.kind === "route") return "Route";
  }
  return "Order";
}

export { V4FlowSummary };
