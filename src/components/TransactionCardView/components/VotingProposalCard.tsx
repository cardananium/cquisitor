"use client";

import React, { useMemo, useRef, useEffect } from "react";
import { CopyButton } from "./CopyButton";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { AddressWithTooltip } from "../../AddressWithTooltip";
import { getPathDiagnostics, formatAda, getStakeKeyLink, getGovActionLink } from "../utils";
import { encodeGovernanceActionId } from "@/utils/cip129";
import type { 
  VotingProposal, 
  GovernanceAction,
  Anchor,
  ValidationDiagnostic,
  CardanoNetwork,
  UnitInterval
} from "../types";

interface VotingProposalCardProps {
  proposal: VotingProposal;
  index: number;
  network?: CardanoNetwork;
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
}

// Get governance action type info
function getGovernanceActionInfo(action: GovernanceAction): { type: string; icon: string; colorClass: string } {
  if ("ParameterChangeAction" in action) {
    return { type: "Parameter Change", icon: "⚙️", colorClass: "tcv-action-param" };
  }
  if ("HardForkInitiationAction" in action) {
    return { type: "Hard Fork Initiation", icon: "🔱", colorClass: "tcv-action-hardfork" };
  }
  if ("TreasuryWithdrawalsAction" in action) {
    return { type: "Treasury Withdrawal", icon: "💰", colorClass: "tcv-action-treasury" };
  }
  if ("NoConfidenceAction" in action) {
    return { type: "No Confidence", icon: "🚫", colorClass: "tcv-action-noconf" };
  }
  if ("UpdateCommitteeAction" in action) {
    return { type: "Update Committee", icon: "👥", colorClass: "tcv-action-committee" };
  }
  if ("NewConstitutionAction" in action) {
    return { type: "New Constitution", icon: "📜", colorClass: "tcv-action-constitution" };
  }
  if ("InfoAction" in action) {
    return { type: "Info Action", icon: "ℹ️", colorClass: "tcv-action-info" };
  }
  return { type: "Unknown Action", icon: "❓", colorClass: "" };
}

// Format Anchor display
function AnchorDisplay({ anchor, label }: { anchor: Anchor; label?: string }) {
  return (
    <div className="tcv-anchor-section">
      {label && <div className="tcv-anchor-label">{label}</div>}
      <div className="tcv-cert-row">
        <span className="tcv-cert-label">URL</span>
        <a href={anchor.anchor_url} target="_blank" rel="noopener noreferrer" className="tcv-anchor-url">
          {anchor.anchor_url}
        </a>
      </div>
      <div className="tcv-cert-row">
        <span className="tcv-cert-label">Data Hash</span>
        <div className="tcv-cert-value-row">
          <span className="tcv-cert-hash">{anchor.anchor_data_hash}</span>
          <CopyButton text={anchor.anchor_data_hash} />
        </div>
      </div>
    </div>
  );
}

// Format unit interval as percentage
function formatQuorum(interval: UnitInterval): string {
  const num = Number(interval.numerator);
  const denom = Number(interval.denominator);
  if (denom === 0) return "N/A";
  return `${((num / denom) * 100).toFixed(2)}%`;
}

// Display previous governance action ID in format hash#index
function PrevGovActionDisplay({ txId, index, network }: { txId: string; index: number; network?: CardanoNetwork }) {
  const fullId = `${txId}#${index}`;
  
  // Encode to CIP-129 bech32 format
  const bech32ActionId = useMemo(() => {
    try {
      return encodeGovernanceActionId({ txHash: txId, index });
    } catch {
      return null;
    }
  }, [txId, index]);
  
  const cardanoscanUrl = bech32ActionId && network ? getGovActionLink(network, bech32ActionId) : null;
  
  return (
    <div className="tcv-prev-gov-action">
      <span className="tcv-prev-gov-label">Previous Gov Action ID</span>
      <div className="tcv-prev-gov-value">
        <span className="tcv-prev-gov-id">{txId}<span className="tcv-prev-gov-index">#{index}</span></span>
        <CopyButton text={fullId} />
      </div>
      {bech32ActionId && (
        <div className="tcv-prev-gov-bech32">
          {cardanoscanUrl ? (
            <a href={cardanoscanUrl} target="_blank" rel="noopener noreferrer" className="tcv-prev-gov-bech32-link">
              {bech32ActionId}
            </a>
          ) : (
            <span className="tcv-prev-gov-bech32-value">{bech32ActionId}</span>
          )}
          <CopyButton text={bech32ActionId} />
        </div>
      )}
    </div>
  );
}

// Format parameter name for display
function formatParamName(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// Format parameter value for display
function formatParamValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  
  // Handle rational numbers (like execution costs)
  if (typeof value === 'object' && value !== null && 'numerator' in value && 'denominator' in value) {
    const v = value as { numerator: string | number; denominator: string | number };
    const num = Number(v.numerator);
    const denom = Number(v.denominator);
    if (denom === 0) return 'N/A';
    return `${(num / denom).toFixed(6)}`;
  }
  
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  
  return String(value);
}

// Display governance action details
function GovernanceActionDetails({ action, network }: { action: GovernanceAction; network?: CardanoNetwork }) {
  if ("ParameterChangeAction" in action) {
    const data = action.ParameterChangeAction;
    const params = Object.entries(data.protocol_param_updates).filter(([, v]) => v !== null && v !== undefined);
    
    return (
      <div className="tcv-action-details">
        {data.policy_hash && (
          <div className="tcv-cert-row">
            <span className="tcv-cert-label">Guardrails Script Hash</span>
            <div className="tcv-cert-value-row">
              <span className="tcv-cert-hash">{data.policy_hash}</span>
              <CopyButton text={data.policy_hash} />
            </div>
          </div>
        )}
        
        {params.length > 0 && (
          <div className="tcv-action-subsection">
            <div className="tcv-subsection-header">
              <span className="tcv-subsection-icon">⚙️</span>
              <span className="tcv-subsection-title">Parameters to Update ({params.length})</span>
            </div>
            <div className="tcv-params-list">
              {params.map(([key, value]) => (
                <div key={key} className="tcv-param-item">
                  <span className="tcv-param-name">{formatParamName(key)}</span>
                  <span className="tcv-param-value">{formatParamValue(value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {data.gov_action_id && (
          <PrevGovActionDisplay txId={data.gov_action_id.transaction_id} index={data.gov_action_id.index} network={network} />
        )}
      </div>
    );
  }

  if ("HardForkInitiationAction" in action) {
    const data = action.HardForkInitiationAction;
    return (
      <div className="tcv-action-details">
        <div className="tcv-hardfork-version">
          <span className="tcv-version-label">Target Protocol Version</span>
          <span className="tcv-version-value">{data.protocol_version.major}.{data.protocol_version.minor}</span>
        </div>
        
        <div className="tcv-action-description">
          🔱 This action initiates a hard fork to upgrade the protocol to a new version.
        </div>
        
        {data.gov_action_id && (
          <PrevGovActionDisplay txId={data.gov_action_id.transaction_id} index={data.gov_action_id.index} network={network} />
        )}
      </div>
    );
  }

  if ("TreasuryWithdrawalsAction" in action) {
    const data = action.TreasuryWithdrawalsAction;
    const withdrawals = Object.entries(data.withdrawals);
    const totalAmount = withdrawals.reduce(
      (sum, [, amt]) => sum + BigInt(amt), 
      BigInt(0)
    );
    
    return (
      <div className="tcv-action-details">
        {data.policy_hash && (
          <div className="tcv-cert-row">
            <span className="tcv-cert-label">Guardrails Script Hash</span>
            <div className="tcv-cert-value-row">
              <span className="tcv-cert-hash">{data.policy_hash}</span>
              <CopyButton text={data.policy_hash} />
            </div>
          </div>
        )}
        
        <div className="tcv-treasury-summary">
          <div className="tcv-treasury-total">
            <span className="tcv-treasury-total-label">Total Treasury Withdrawal</span>
            <span className="tcv-ada-amount tcv-treasury-amount">₳ {formatAda(totalAmount.toString())}</span>
          </div>
        </div>
        
        <div className="tcv-action-subsection">
          <div className="tcv-subsection-header">
            <span className="tcv-subsection-icon">👥</span>
            <span className="tcv-subsection-title">Recipients ({withdrawals.length})</span>
          </div>
          <div className="tcv-recipients-list">
            {withdrawals.map(([address, amount], idx) => (
              <div key={address} className="tcv-recipient-item">
                <div className="tcv-recipient-header">
                  <span className="tcv-recipient-index">#{idx}</span>
                  <span className="tcv-ada-amount">₳ {formatAda(amount)}</span>
                </div>
                <div className="tcv-recipient-address">
                  <AddressWithTooltip 
                    address={address}
                    linkUrl={network ? getStakeKeyLink(network, address) : null}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if ("NoConfidenceAction" in action) {
    const data = action.NoConfidenceAction;
    return (
      <div className="tcv-action-details">
        <div className="tcv-noconf-banner">
          <span className="tcv-noconf-icon">🚫</span>
          <div className="tcv-noconf-text">
            <span className="tcv-noconf-title">Vote of No Confidence</span>
            <span className="tcv-noconf-desc">This action expresses no confidence in the current constitutional committee, triggering a new committee election.</span>
          </div>
        </div>
        
        {data.gov_action_id && (
          <PrevGovActionDisplay txId={data.gov_action_id.transaction_id} index={data.gov_action_id.index} network={network} />
        )}
      </div>
    );
  }

  if ("UpdateCommitteeAction" in action) {
    const data = action.UpdateCommitteeAction;
    return (
      <div className="tcv-action-details">
        <div className="tcv-committee-quorum">
          <span className="tcv-quorum-label">Quorum Threshold</span>
          <span className="tcv-quorum-value">{formatQuorum(data.committee.quorum_threshold)}</span>
        </div>
        
        {data.committee.members.length > 0 && (
          <div className="tcv-action-subsection tcv-members-add">
            <div className="tcv-subsection-header">
              <span className="tcv-subsection-icon">➕</span>
              <span className="tcv-subsection-title">New Members ({data.committee.members.length})</span>
            </div>
            <div className="tcv-members-list">
              {data.committee.members.map((member, idx) => {
                const cred = member.stake_credential;
                const isScript = "Script" in cred;
                const hash = isScript ? (cred as { Script: string }).Script : (cred as { Key: string }).Key;
                return (
                  <div key={idx} className="tcv-member-item">
                    <div className="tcv-member-header">
                      <span className="tcv-member-index">#{idx}</span>
                      <span className={`tcv-cred-type ${isScript ? 'script' : 'key'}`}>
                        {isScript ? 'Script' : 'Key'}
                      </span>
                      <span className="tcv-member-term">Term: Epoch {member.term_limit}</span>
                    </div>
                    <div className="tcv-member-hash">
                      <span className="tcv-cert-hash">{hash}</span>
                      <CopyButton text={hash} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {data.members_to_remove.length > 0 && (
          <div className="tcv-action-subsection tcv-members-remove">
            <div className="tcv-subsection-header">
              <span className="tcv-subsection-icon">➖</span>
              <span className="tcv-subsection-title">Members to Remove ({data.members_to_remove.length})</span>
            </div>
            <div className="tcv-members-list">
              {data.members_to_remove.map((credItem, idx) => {
                const isScript = "Script" in credItem;
                const hash = isScript ? (credItem as { Script: string }).Script : (credItem as { Key: string }).Key;
                return (
                  <div key={idx} className="tcv-member-item tcv-member-remove">
                    <div className="tcv-member-header">
                      <span className="tcv-member-index">#{idx}</span>
                      <span className={`tcv-cred-type ${isScript ? 'script' : 'key'}`}>
                        {isScript ? 'Script' : 'Key'}
                      </span>
                    </div>
                    <div className="tcv-member-hash">
                      <span className="tcv-cert-hash">{hash}</span>
                      <CopyButton text={hash} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {data.gov_action_id && (
          <PrevGovActionDisplay txId={data.gov_action_id.transaction_id} index={data.gov_action_id.index} network={network} />
        )}
      </div>
    );
  }

  if ("NewConstitutionAction" in action) {
    const data = action.NewConstitutionAction;
    return (
      <div className="tcv-action-details">
        <div className="tcv-constitution-banner">
          <span className="tcv-constitution-icon">📜</span>
          <span className="tcv-constitution-title">New Constitution Proposal</span>
        </div>
        
        <div className="tcv-action-subsection">
          <div className="tcv-subsection-header">
            <span className="tcv-subsection-icon">🔗</span>
            <span className="tcv-subsection-title">Constitution Document</span>
          </div>
          <AnchorDisplay anchor={data.constitution.anchor} />
        </div>
        
        {data.constitution.script_hash && (
          <div className="tcv-action-subsection">
            <div className="tcv-subsection-header">
              <span className="tcv-subsection-icon">📝</span>
              <span className="tcv-subsection-title">Guardrails Script</span>
            </div>
            <div className="tcv-cert-row">
              <span className="tcv-cert-label">Script Hash</span>
              <div className="tcv-cert-value-row">
                <span className="tcv-cert-hash">{data.constitution.script_hash}</span>
                <CopyButton text={data.constitution.script_hash} />
              </div>
            </div>
          </div>
        )}
        
        {data.gov_action_id && (
          <PrevGovActionDisplay txId={data.gov_action_id.transaction_id} index={data.gov_action_id.index} network={network} />
        )}
      </div>
    );
  }

  if ("InfoAction" in action) {
    return (
      <div className="tcv-action-details">
        <div className="tcv-info-banner">
          <span className="tcv-info-icon">ℹ️</span>
          <div className="tcv-info-text">
            <span className="tcv-info-title">Informational Action</span>
            <span className="tcv-info-desc">This action has no on-chain effect. It is used to poll the community or record information on-chain.</span>
          </div>
        </div>
      </div>
    );
  }

  return <div className="tcv-action-unknown">Action details not available</div>;
}

export function VotingProposalCard({ 
  proposal, 
  index, 
  network,
  path,
  diagnosticsMap,
  focusedPath
}: VotingProposalCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const diagnostics = getPathDiagnostics(path, diagnosticsMap);
  const isFocused = focusedPath?.includes(path) ?? false;
  const { type, icon, colorClass } = getGovernanceActionInfo(proposal.governance_action);
  
  // Scroll into view when focused
  useEffect(() => {
    if (isFocused && cardRef.current) {
      setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [isFocused]);
  
  return (
    <div ref={cardRef} className={`tcv-item-card tcv-voting-proposal ${colorClass} ${diagnostics.length > 0 ? (diagnostics.some(d => d.severity === 'error') ? 'has-error' : 'has-warning') : ''} ${isFocused ? 'is-focused' : ''}`}>
      <div className="tcv-item-header">
        <span className="tcv-item-index">#{index}</span>
        <span className="tcv-action-type-badge">
          <span className="tcv-action-icon">{icon}</span>
          {type}
        </span>
        <DiagnosticBadge diagnostics={diagnostics} />
      </div>
      
      <div className="tcv-voting-proposal-details">
        <div className="tcv-proposal-deposit-row">
          <span className="tcv-cert-label">Deposit</span>
          <span className="tcv-ada-amount">₳ {formatAda(proposal.deposit)}</span>
        </div>
        
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Return Address</span>
          <div className="tcv-cert-value-row">
            <AddressWithTooltip 
              address={proposal.reward_account}
              linkUrl={network ? getStakeKeyLink(network, proposal.reward_account) : null}
            />
          </div>
        </div>
        
        <div className="tcv-proposal-anchor-section">
          <AnchorDisplay anchor={proposal.anchor} label="Proposal Anchor" />
        </div>
        
        <div className="tcv-proposal-action-section">
          <div className="tcv-section-label">Governance Action Body</div>
          <GovernanceActionDetails action={proposal.governance_action} network={network} />
        </div>
      </div>
    </div>
  );
}

