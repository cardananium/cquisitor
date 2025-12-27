"use client";

import React, { useRef, useEffect } from "react";
import { CopyButton } from "./CopyButton";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { getPathDiagnostics, formatAda } from "../utils";
import type { 
  Certificate, 
  ValidationDiagnostic,
  CredType,
  DRep,
  Anchor,
  PoolParams,
  Relay
} from "../types";

interface CertificateCardProps {
  cert: Certificate;
  index: number;
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
}

// Get certificate type name and icon
function getCertificateInfo(cert: Certificate): { type: string; icon: string; colorClass: string } {
  if ("StakeRegistration" in cert) {
    return { type: "Stake Registration (StakeRegistration)", icon: "📋", colorClass: "tcv-cert-stake-reg" };
  }
  if ("StakeDeregistration" in cert) {
    return { type: "Stake Deregistration (StakeDeregistration)", icon: "📤", colorClass: "tcv-cert-stake-dereg" };
  }
  if ("StakeDelegation" in cert) {
    return { type: "Stake Delegation (StakeDelegation)", icon: "🤝", colorClass: "tcv-cert-stake-deleg" };
  }
  if ("PoolRegistration" in cert) {
    return { type: "Pool Registration (PoolRegistration)", icon: "🏊", colorClass: "tcv-cert-pool-reg" };
  }
  if ("PoolRetirement" in cert) {
    return { type: "Pool Retirement (PoolRetirement)", icon: "🛑", colorClass: "tcv-cert-pool-retire" };
  }
  if ("GenesisKeyDelegation" in cert) {
    return { type: "Genesis Key Delegation (GenesisKeyDelegation)", icon: "🔑", colorClass: "tcv-cert-genesis" };
  }
  if ("MoveInstantaneousRewardsCert" in cert) {
    return { type: "MIR Certificate (MoveInstantaneousRewardsCert)", icon: "💸", colorClass: "tcv-cert-mir" };
  }
  if ("CommitteeHotAuth" in cert) {
    return { type: "Committee Hot Auth (CommitteeHotAuth)", icon: "🔥", colorClass: "tcv-cert-committee" };
  }
  if ("CommitteeColdResign" in cert) {
    return { type: "Committee Cold Resign (CommitteeColdResign)", icon: "❄️", colorClass: "tcv-cert-committee" };
  }
  if ("DRepDeregistration" in cert) {
    return { type: "DRep Deregistration (DRepDeregistration)", icon: "🗳️", colorClass: "tcv-cert-drep" };
  }
  if ("DRepRegistration" in cert) {
    return { type: "DRep Registration (DRepRegistration)", icon: "🗳️", colorClass: "tcv-cert-drep" };
  }
  if ("DRepUpdate" in cert) {
    return { type: "DRep Update (DRepUpdate)", icon: "🗳️", colorClass: "tcv-cert-drep" };
  }
  if ("StakeAndVoteDelegation" in cert) {
    // Delegates stake to pool AND voting power to DRep simultaneously
    return { type: "Stake + Vote Delegation (StakeAndVoteDelegation)", icon: "🤝🗳️", colorClass: "tcv-cert-combined-deleg" };
  }
  if ("StakeRegistrationAndDelegation" in cert) {
    // Registers stake credential with deposit AND delegates to pool in one tx
    return { type: "Register + Stake Delegation (StakeRegistrationAndDelegation)", icon: "📋🤝", colorClass: "tcv-cert-stake-reg" };
  }
  if ("StakeVoteRegistrationAndDelegation" in cert) {
    // All-in-one: Register stake + delegate to pool + delegate voting to DRep
    return { type: "Register + Stake + Vote Delegation (StakeVoteRegistrationAndDelegation)", icon: "📋🤝🗳️", colorClass: "tcv-cert-combined-deleg" };
  }
  if ("VoteDelegation" in cert) {
    // Delegates voting power to a DRep (Delegated Representative)
    return { type: "Vote Delegation (VoteDelegation)", icon: "🗳️", colorClass: "tcv-cert-vote-deleg" };
  }
  if ("VoteRegistrationAndDelegation" in cert) {
    // Registers stake credential with deposit AND delegates voting to DRep
    return { type: "Register + Vote Delegation (VoteRegistrationAndDelegation)", icon: "📋🗳️", colorClass: "tcv-cert-vote-deleg" };
  }
  return { type: "Unknown Certificate", icon: "❓", colorClass: "" };
}

// Format credential display
function CredentialDisplay({ cred, label }: { cred: CredType; label: string }) {
  const isScript = "Script" in cred;
  const hash = isScript ? cred.Script : cred.Key;
  
  return (
    <div className="tcv-cert-row">
      <span className="tcv-cert-label">{label}</span>
      <div className="tcv-cert-value-row">
        <span className={`tcv-cred-type ${isScript ? 'script' : 'key'}`}>
          {isScript ? 'Script' : 'Key'}
        </span>
        <span className="tcv-cert-hash">{hash}</span>
        <CopyButton text={hash} />
      </div>
    </div>
  );
}

// Format DRep display
function DRepDisplay({ drep, label }: { drep: DRep; label: string }) {
  if (drep === "AlwaysAbstain") {
    return (
      <div className="tcv-cert-row">
        <span className="tcv-cert-label">{label}</span>
        <span className="tcv-drep-special">Always Abstain</span>
      </div>
    );
  }
  if (drep === "AlwaysNoConfidence") {
    return (
      <div className="tcv-cert-row">
        <span className="tcv-cert-label">{label}</span>
        <span className="tcv-drep-special">Always No Confidence</span>
      </div>
    );
  }
  if ("KeyHash" in drep) {
    return (
      <div className="tcv-cert-row">
        <span className="tcv-cert-label">{label}</span>
        <div className="tcv-cert-value-row">
          <span className="tcv-cred-type key">Key</span>
          <span className="tcv-cert-hash">{drep.KeyHash}</span>
          <CopyButton text={drep.KeyHash} />
        </div>
      </div>
    );
  }
  if ("ScriptHash" in drep) {
    return (
      <div className="tcv-cert-row">
        <span className="tcv-cert-label">{label}</span>
        <div className="tcv-cert-value-row">
          <span className="tcv-cred-type script">Script</span>
          <span className="tcv-cert-hash">{drep.ScriptHash}</span>
          <CopyButton text={drep.ScriptHash} />
        </div>
      </div>
    );
  }
  return null;
}

// Format Anchor display
function AnchorDisplay({ anchor }: { anchor: Anchor }) {
  return (
    <div className="tcv-anchor-section">
      <div className="tcv-cert-row">
        <span className="tcv-cert-label">Anchor URL</span>
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

// Format Pool Params
function PoolParamsDisplay({ params }: { params: PoolParams }) {
  return (
    <div className="tcv-pool-params">
      <div className="tcv-cert-row">
        <span className="tcv-cert-label">Operator</span>
        <div className="tcv-cert-value-row">
          <span className="tcv-cert-hash">{params.operator}</span>
          <CopyButton text={params.operator} />
        </div>
      </div>
      <div className="tcv-cert-row">
        <span className="tcv-cert-label">VRF Key Hash</span>
        <div className="tcv-cert-value-row">
          <span className="tcv-cert-hash">{params.vrf_keyhash}</span>
          <CopyButton text={params.vrf_keyhash} />
        </div>
      </div>
      <div className="tcv-cert-row">
        <span className="tcv-cert-label">Pledge</span>
        <span className="tcv-ada-amount">₳ {formatAda(params.pledge)}</span>
      </div>
      <div className="tcv-cert-row">
        <span className="tcv-cert-label">Cost</span>
        <span className="tcv-ada-amount">₳ {formatAda(params.cost)}</span>
      </div>
      <div className="tcv-cert-row">
        <span className="tcv-cert-label">Margin</span>
        <span className="tcv-cert-value">
          {((Number(params.margin.numerator) / Number(params.margin.denominator)) * 100).toFixed(2)}%
        </span>
      </div>
      <div className="tcv-cert-row">
        <span className="tcv-cert-label">Reward Account</span>
        <div className="tcv-cert-value-row">
          <span className="tcv-cert-hash">{params.reward_account}</span>
          <CopyButton text={params.reward_account} />
        </div>
      </div>
      {params.pool_owners.length > 0 && (
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Owners ({params.pool_owners.length})</span>
          <div className="tcv-owners-list">
            {params.pool_owners.map((owner, i) => (
              <div key={i} className="tcv-owner-item">
                <span className="tcv-cert-hash">{owner}</span>
                <CopyButton text={owner} />
              </div>
            ))}
          </div>
        </div>
      )}
      {params.relays.length > 0 && (
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Relays ({params.relays.length})</span>
          <div className="tcv-relays-list">
            {params.relays.map((relay, i) => (
              <RelayDisplay key={i} relay={relay} />
            ))}
          </div>
        </div>
      )}
      {params.pool_metadata && (
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Metadata URL</span>
          <a href={params.pool_metadata.url} target="_blank" rel="noopener noreferrer" className="tcv-anchor-url">
            {params.pool_metadata.url}
          </a>
        </div>
      )}
    </div>
  );
}

// Format Relay display
function RelayDisplay({ relay }: { relay: Relay }) {
  if ("SingleHostAddr" in relay) {
    const r = relay.SingleHostAddr;
    return (
      <div className="tcv-relay-item">
        <span className="tcv-relay-type">Single Host Addr</span>
        {r.ipv4 && <span className="tcv-relay-info">{r.ipv4.join(".")}</span>}
        {r.ipv6 && <span className="tcv-relay-info">IPv6</span>}
        {r.port && <span className="tcv-relay-info">:{r.port}</span>}
      </div>
    );
  }
  if ("SingleHostName" in relay) {
    const r = relay.SingleHostName;
    return (
      <div className="tcv-relay-item">
        <span className="tcv-relay-type">DNS</span>
        <span className="tcv-relay-info">{r.dns_name}{r.port ? `:${r.port}` : ''}</span>
      </div>
    );
  }
  if ("MultiHostName" in relay) {
    return (
      <div className="tcv-relay-item">
        <span className="tcv-relay-type">Multi DNS</span>
        <span className="tcv-relay-info">{relay.MultiHostName.dns_name}</span>
      </div>
    );
  }
  return null;
}

// Render certificate details based on type
function CertificateDetails({ cert }: { cert: Certificate }) {
  if ("StakeRegistration" in cert) {
    const data = cert.StakeRegistration;
    return (
      <>
        <CredentialDisplay cred={data.stake_credential} label="Stake Credential" />
        {data.coin && (
          <div className="tcv-cert-row">
            <span className="tcv-cert-label">Deposit</span>
            <span className="tcv-ada-amount">₳ {formatAda(data.coin)}</span>
          </div>
        )}
      </>
    );
  }

  if ("StakeDeregistration" in cert) {
    const data = cert.StakeDeregistration;
    return (
      <>
        <CredentialDisplay cred={data.stake_credential} label="Stake Credential" />
        {data.coin && (
          <div className="tcv-cert-row">
            <span className="tcv-cert-label">Refund</span>
            <span className="tcv-ada-amount">₳ {formatAda(data.coin)}</span>
          </div>
        )}
      </>
    );
  }

  if ("StakeDelegation" in cert) {
    const data = cert.StakeDelegation;
    return (
      <>
        <CredentialDisplay cred={data.stake_credential} label="Stake Credential" />
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Pool</span>
          <div className="tcv-cert-value-row">
            <span className="tcv-cert-hash">{data.pool_keyhash}</span>
            <CopyButton text={data.pool_keyhash} />
          </div>
        </div>
      </>
    );
  }

  if ("PoolRegistration" in cert) {
    return <PoolParamsDisplay params={cert.PoolRegistration.pool_params} />;
  }

  if ("PoolRetirement" in cert) {
    const data = cert.PoolRetirement;
    return (
      <>
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Pool</span>
          <div className="tcv-cert-value-row">
            <span className="tcv-cert-hash">{data.pool_keyhash}</span>
            <CopyButton text={data.pool_keyhash} />
          </div>
        </div>
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Retirement Epoch</span>
          <span className="tcv-cert-value">{data.epoch}</span>
        </div>
      </>
    );
  }

  if ("GenesisKeyDelegation" in cert) {
    const data = cert.GenesisKeyDelegation;
    return (
      <>
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Genesis Hash</span>
          <div className="tcv-cert-value-row">
            <span className="tcv-cert-hash">{data.genesishash}</span>
            <CopyButton text={data.genesishash} />
          </div>
        </div>
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Delegate Hash</span>
          <div className="tcv-cert-value-row">
            <span className="tcv-cert-hash">{data.genesis_delegate_hash}</span>
            <CopyButton text={data.genesis_delegate_hash} />
          </div>
        </div>
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">VRF Key Hash</span>
          <div className="tcv-cert-value-row">
            <span className="tcv-cert-hash">{data.vrf_keyhash}</span>
            <CopyButton text={data.vrf_keyhash} />
          </div>
        </div>
      </>
    );
  }

  if ("MoveInstantaneousRewardsCert" in cert) {
    const mir = cert.MoveInstantaneousRewardsCert.move_instantaneous_reward;
    return (
      <>
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Source</span>
          <span className="tcv-cert-value">{mir.pot}</span>
        </div>
        {"ToOtherPot" in mir.variant && (
          <div className="tcv-cert-row">
            <span className="tcv-cert-label">Amount</span>
            <span className="tcv-ada-amount">₳ {formatAda(mir.variant.ToOtherPot)}</span>
          </div>
        )}
        {"ToStakeCredentials" in mir.variant && (
          <div className="tcv-cert-row">
            <span className="tcv-cert-label">Recipients</span>
            <span className="tcv-cert-value">{mir.variant.ToStakeCredentials.length} credential(s)</span>
          </div>
        )}
      </>
    );
  }

  if ("CommitteeHotAuth" in cert) {
    const data = cert.CommitteeHotAuth;
    return (
      <>
        <CredentialDisplay cred={data.committee_cold_credential} label="Cold Credential" />
        <CredentialDisplay cred={data.committee_hot_credential} label="Hot Credential" />
      </>
    );
  }

  if ("CommitteeColdResign" in cert) {
    const data = cert.CommitteeColdResign;
    return (
      <>
        <CredentialDisplay cred={data.committee_cold_credential} label="Cold Credential" />
        {data.anchor && <AnchorDisplay anchor={data.anchor} />}
      </>
    );
  }

  if ("DRepRegistration" in cert) {
    const data = cert.DRepRegistration;
    return (
      <>
        <CredentialDisplay cred={data.voting_credential} label="Voting Credential" />
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Deposit</span>
          <span className="tcv-ada-amount">₳ {formatAda(data.coin)}</span>
        </div>
        {data.anchor && <AnchorDisplay anchor={data.anchor} />}
      </>
    );
  }

  if ("DRepDeregistration" in cert) {
    const data = cert.DRepDeregistration;
    return (
      <>
        <CredentialDisplay cred={data.voting_credential} label="Voting Credential" />
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Refund</span>
          <span className="tcv-ada-amount">₳ {formatAda(data.coin)}</span>
        </div>
      </>
    );
  }

  if ("DRepUpdate" in cert) {
    const data = cert.DRepUpdate;
    return (
      <>
        <CredentialDisplay cred={data.voting_credential} label="Voting Credential" />
        {data.anchor && <AnchorDisplay anchor={data.anchor} />}
      </>
    );
  }

  if ("VoteDelegation" in cert) {
    const data = cert.VoteDelegation;
    return (
      <>
        <CredentialDisplay cred={data.stake_credential} label="Stake Credential" />
        <DRepDisplay drep={data.drep} label="DRep" />
      </>
    );
  }

  if ("StakeAndVoteDelegation" in cert) {
    const data = cert.StakeAndVoteDelegation;
    return (
      <>
        <CredentialDisplay cred={data.stake_credential} label="Stake Credential" />
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Pool</span>
          <div className="tcv-cert-value-row">
            <span className="tcv-cert-hash">{data.pool_keyhash}</span>
            <CopyButton text={data.pool_keyhash} />
          </div>
        </div>
        <DRepDisplay drep={data.drep} label="DRep" />
      </>
    );
  }

  if ("StakeRegistrationAndDelegation" in cert) {
    const data = cert.StakeRegistrationAndDelegation;
    return (
      <>
        <CredentialDisplay cred={data.stake_credential} label="Stake Credential" />
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Pool</span>
          <div className="tcv-cert-value-row">
            <span className="tcv-cert-hash">{data.pool_keyhash}</span>
            <CopyButton text={data.pool_keyhash} />
          </div>
        </div>
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Deposit</span>
          <span className="tcv-ada-amount">₳ {formatAda(data.coin)}</span>
        </div>
      </>
    );
  }

  if ("StakeVoteRegistrationAndDelegation" in cert) {
    const data = cert.StakeVoteRegistrationAndDelegation;
    return (
      <>
        <CredentialDisplay cred={data.stake_credential} label="Stake Credential" />
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Pool</span>
          <div className="tcv-cert-value-row">
            <span className="tcv-cert-hash">{data.pool_keyhash}</span>
            <CopyButton text={data.pool_keyhash} />
          </div>
        </div>
        <DRepDisplay drep={data.drep} label="DRep" />
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Deposit</span>
          <span className="tcv-ada-amount">₳ {formatAda(data.coin)}</span>
        </div>
      </>
    );
  }

  if ("VoteRegistrationAndDelegation" in cert) {
    const data = cert.VoteRegistrationAndDelegation;
    return (
      <>
        <CredentialDisplay cred={data.stake_credential} label="Stake Credential" />
        <DRepDisplay drep={data.drep} label="DRep" />
        <div className="tcv-cert-row">
          <span className="tcv-cert-label">Deposit</span>
          <span className="tcv-ada-amount">₳ {formatAda(data.coin)}</span>
        </div>
      </>
    );
  }

  return <div className="tcv-cert-unknown">Certificate details not available</div>;
}

export function CertificateCard({ 
  cert, 
  index, 
  path,
  diagnosticsMap,
  focusedPath
}: CertificateCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const diagnostics = getPathDiagnostics(path, diagnosticsMap);
  const isFocused = focusedPath?.includes(path) ?? false;
  const { type, icon, colorClass } = getCertificateInfo(cert);
  
  // Scroll into view when focused
  useEffect(() => {
    if (isFocused && cardRef.current) {
      setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [isFocused]);
  
  return (
    <div ref={cardRef} className={`tcv-item-card tcv-certificate ${colorClass} ${diagnostics.length > 0 ? (diagnostics.some(d => d.severity === 'error') ? 'has-error' : 'has-warning') : ''} ${isFocused ? 'is-focused' : ''}`}>
      <div className="tcv-item-header">
        <span className="tcv-item-index">#{index}</span>
        <span className="tcv-cert-type-badge">
          <span className="tcv-cert-icon">{icon}</span>
          {type}
        </span>
        <DiagnosticBadge diagnostics={diagnostics} />
      </div>
      
      <div className="tcv-cert-details">
        <CertificateDetails cert={cert} />
      </div>
    </div>
  );
}

