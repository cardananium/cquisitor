"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { CopyButton } from "./CopyButton";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { getPathDiagnostics, getGovActionLink } from "../utils";
import { encodeGovernanceActionId } from "@/utils/cip129";
import type { 
  VoterVotes, 
  Vote,
  Voter,
  CredType,
  Anchor,
  ValidationDiagnostic,
  CardanoNetwork
} from "../types";

interface VotingProcedureCardProps {
  voterVotes: VoterVotes;
  index: number;
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
  network?: CardanoNetwork;
}

// Get voter type info
function getVoterInfo(voter: Voter): { type: string; icon: string; colorClass: string } {
  if ("ConstitutionalCommitteeHotCred" in voter) {
    return { type: "Constitutional Committee", icon: "🏛️", colorClass: "tcv-voter-committee" };
  }
  if ("DRep" in voter) {
    return { type: "DRep", icon: "🗳️", colorClass: "tcv-voter-drep" };
  }
  if ("StakingPool" in voter) {
    return { type: "Staking Pool", icon: "🏊", colorClass: "tcv-voter-pool" };
  }
  return { type: "Unknown Voter", icon: "❓", colorClass: "" };
}

// Get vote kind styling
function getVoteKindStyle(vote: string): { icon: string; colorClass: string } {
  switch (vote) {
    case "Yes":
      return { icon: "✅", colorClass: "tcv-vote-yes" };
    case "No":
      return { icon: "❌", colorClass: "tcv-vote-no" };
    case "Abstain":
      return { icon: "⏸️", colorClass: "tcv-vote-abstain" };
    default:
      return { icon: "❓", colorClass: "" };
  }
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

// Display voter details
function VoterDisplay({ voter }: { voter: Voter }) {
  if ("ConstitutionalCommitteeHotCred" in voter) {
    return <CredentialDisplay cred={voter.ConstitutionalCommitteeHotCred} label="Hot Credential" />;
  }
  if ("DRep" in voter) {
    return <CredentialDisplay cred={voter.DRep} label="DRep Credential" />;
  }
  if ("StakingPool" in voter) {
    return (
      <div className="tcv-cert-row">
        <span className="tcv-cert-label">Pool ID</span>
        <div className="tcv-cert-value-row">
          <span className="tcv-cert-hash">{voter.StakingPool}</span>
          <CopyButton text={voter.StakingPool} />
        </div>
      </div>
    );
  }
  return null;
}

// Single vote item display
function VoteItem({ vote, index, network }: { vote: Vote; index: number; network?: CardanoNetwork }) {
  const { icon, colorClass } = getVoteKindStyle(vote.voting_procedure.vote);
  const fullActionId = `${vote.action_id.transaction_id}#${vote.action_id.index}`;
  
  // Encode to CIP-129 bech32 format
  const bech32ActionId = useMemo(() => {
    try {
      return encodeGovernanceActionId({
        txHash: vote.action_id.transaction_id,
        index: vote.action_id.index
      });
    } catch {
      return null;
    }
  }, [vote.action_id.transaction_id, vote.action_id.index]);
  
  const cardanoscanUrl = bech32ActionId && network ? getGovActionLink(network, bech32ActionId) : null;
  
  return (
    <div className={`tcv-vote-item ${colorClass}`}>
      <div className="tcv-vote-item-header">
        <span className="tcv-vote-index">#{index}</span>
        <span className="tcv-vote-kind-badge">
          <span className="tcv-vote-icon">{icon}</span>
          {vote.voting_procedure.vote}
        </span>
      </div>
      
      <div className="tcv-vote-gov-action">
        <span className="tcv-vote-gov-label">Gov Action ID</span>
        <div className="tcv-vote-gov-value">
          <span className="tcv-vote-gov-id">
            {vote.action_id.transaction_id}
            <span className="tcv-vote-gov-index">#{vote.action_id.index}</span>
          </span>
          <CopyButton text={fullActionId} />
        </div>
        {bech32ActionId && (
          <div className="tcv-vote-gov-bech32">
            {cardanoscanUrl ? (
              <a href={cardanoscanUrl} target="_blank" rel="noopener noreferrer" className="tcv-vote-gov-bech32-link">
                {bech32ActionId}
              </a>
            ) : (
              <span className="tcv-vote-gov-bech32-value">{bech32ActionId}</span>
            )}
            <CopyButton text={bech32ActionId} />
          </div>
        )}
      </div>
      
      {vote.voting_procedure.anchor && (
        <AnchorDisplay anchor={vote.voting_procedure.anchor} />
      )}
    </div>
  );
}

export function VotingProcedureCard({ 
  voterVotes, 
  index, 
  path,
  diagnosticsMap,
  focusedPath,
  network
}: VotingProcedureCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [showAllVotes, setShowAllVotes] = useState(false);
  const diagnostics = getPathDiagnostics(path, diagnosticsMap);
  const isFocused = focusedPath?.includes(path) ?? false;
  const { type, icon, colorClass } = getVoterInfo(voterVotes.voter);
  
  // Scroll into view when focused
  useEffect(() => {
    if (isFocused && cardRef.current) {
      setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [isFocused]);
  
  const votes = voterVotes.votes;
  const displayedVotes = showAllVotes ? votes : votes.slice(0, 3);
  const hasMore = votes.length > 3;
  
  return (
    <div ref={cardRef} className={`tcv-item-card tcv-voting-procedure ${colorClass} ${diagnostics.length > 0 ? (diagnostics.some(d => d.severity === 'error') ? 'has-error' : 'has-warning') : ''} ${isFocused ? 'is-focused' : ''}`}>
      <div className="tcv-item-header">
        <span className="tcv-item-index">#{index}</span>
        <span className="tcv-voter-type-badge">
          <span className="tcv-voter-icon">{icon}</span>
          {type}
        </span>
        <span className="tcv-votes-count">{votes.length} vote(s)</span>
        <DiagnosticBadge diagnostics={diagnostics} />
      </div>
      
      <div className="tcv-voting-procedure-details">
        <VoterDisplay voter={voterVotes.voter} />
        
        <div className="tcv-votes-section">
          <div className="tcv-votes-header">
            <span className="tcv-section-label">Votes</span>
          </div>
          <div className="tcv-votes-list">
            {displayedVotes.map((vote, i) => (
              <VoteItem key={i} vote={vote} index={i} network={network} />
            ))}
          </div>
          
          {hasMore && (
            <button 
              className="tcv-show-more-btn"
              onClick={() => setShowAllVotes(!showAllVotes)}
            >
              {showAllVotes ? 'Show Less' : `Show ${votes.length - 3} More`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

