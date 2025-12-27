"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { SectionCard, InputCard, OutputCard, VKeyCard, RedeemerCard, MintSection, DiagnosticBadge, CertificateCard, WithdrawalCard, AuxiliaryDataSection, BootstrapWitnessCard, NativeScriptCard, TransactionDetailsSection, RequiredSignersCard, VotingProcedureCard, VotingProposalCard, PlutusScriptCard, PlutusDataCard } from "./components";
import { 
  buildDiagnosticsMap, 
  formatAda,
  isTransactionData 
} from "./utils";
import type { 
  TransactionCardViewProps, 
  TransactionData,
  ValidationDiagnostic
} from "./types";
import type { PlutusScriptInfo } from "@cardananium/cquisitor-lib";

// Re-export types for external usage
export type { 
  ValidationDiagnostic, 
  TransactionCardViewProps,
  CardanoNetwork 
} from "./types";

// Top-level section block component
interface TopLevelSectionProps {
  title: string;
  icon: string;
  colorScheme: "body" | "witness" | "auxiliary";
  badge?: number;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  path?: string;
  diagnosticsMap?: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
}

function TopLevelSection({
  title,
  icon,
  colorScheme,
  badge,
  children,
  defaultExpanded = true,
  path,
  diagnosticsMap,
  focusedPath,
}: TopLevelSectionProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  
  // Count direct errors/warnings (only at this exact path, not children)
  const { directErrorCount, directWarningCount, directDiagnostics } = useMemo(() => {
    if (!diagnosticsMap || !path) return { directErrorCount: 0, directWarningCount: 0, directDiagnostics: [] as ValidationDiagnostic[] };
    const diags = diagnosticsMap.get(path) || [];
    let errors = 0;
    let warnings = 0;
    for (const d of diags) {
      if (d.severity === 'error') errors++;
      else if (d.severity === 'warning') warnings++;
    }
    return { directErrorCount: errors, directWarningCount: warnings, directDiagnostics: diags };
  }, [diagnosticsMap, path]);
  
  // Count child issues (for indicator)
  const { childErrorCount, childWarningCount } = useMemo(() => {
    if (!diagnosticsMap || !path) return { childErrorCount: 0, childWarningCount: 0 };
    let errors = 0;
    let warnings = 0;
    for (const [key, diagnostics] of diagnosticsMap.entries()) {
      if (key.startsWith(path + ".")) {
        for (const d of diagnostics) {
          if (d.severity === 'error') errors++;
          else if (d.severity === 'warning') warnings++;
        }
      }
    }
    return { childErrorCount: errors, childWarningCount: warnings };
  }, [diagnosticsMap, path]);
  
  const hasChildIssues = childErrorCount > 0 || childWarningCount > 0;
  const hasDiagnostics = directErrorCount > 0 || directWarningCount > 0 || hasChildIssues;
  
  // Check if focused - only if this exact path is focused, NOT if a child is focused
  const isFocused = useMemo(() => {
    if (!focusedPath || !path) return false;
    return focusedPath.includes(path);
  }, [focusedPath, path]);

  // Scroll into view when focused
  useEffect(() => {
    if (isFocused && sectionRef.current) {
      setTimeout(() => {
        sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [isFocused]);

  return (
    <div ref={sectionRef} className={`tcv-top-level-section tcv-tls-${colorScheme} ${hasDiagnostics ? 'tcv-tls-has-error' : ''} ${isFocused ? 'tcv-tls-is-focused' : ''}`}>
      <button 
        className="tcv-tls-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <span className="tcv-tls-icon">{icon}</span>
        {hasChildIssues && (
          <Tooltip.Provider delayDuration={100}>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <span className={`tcv-tls-child-indicator ${childErrorCount > 0 ? 'has-errors' : 'has-warnings'}`}>
                  {childErrorCount > 0 ? '⊗' : '△'}
                </span>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className="validation-tooltip" sideOffset={5} side="bottom">
                  <div className="validation-tooltip-content">
                    <div className="validation-tooltip-title">Issues inside</div>
                    {childErrorCount > 0 && (
                      <div className="validation-tooltip-item">
                        <span className="validation-tooltip-message tcv-child-error-msg">⊗ {childErrorCount} error(s)</span>
                      </div>
                    )}
                    {childWarningCount > 0 && (
                      <div className="validation-tooltip-item">
                        <span className="validation-tooltip-message tcv-child-warning-msg">△ {childWarningCount} warning(s)</span>
                      </div>
                    )}
                  </div>
                  <Tooltip.Arrow className="validation-tooltip-arrow" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </Tooltip.Provider>
        )}
        <span className="tcv-tls-title">{title}</span>
        {badge !== undefined && badge > 0 && (
          <span className="tcv-tls-badge">{badge}</span>
        )}
        <DiagnosticBadge diagnostics={directDiagnostics} />
        <span className={`tcv-tls-chevron ${isExpanded ? 'tcv-tls-chevron-open' : ''}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      </button>
      {isExpanded && (
        <div className="tcv-tls-content">
          {children}
        </div>
      )}
    </div>
  );
}

// Main component
export default function TransactionCardView({
  data,
  network,
  diagnostics = [],
  focusedPath,
  extractedHashes,
  inputUtxoInfoMap,
}: TransactionCardViewProps): React.ReactElement {
  const diagnosticsMap = useMemo(() => buildDiagnosticsMap(diagnostics), [diagnostics]);
  
  if (!data.transaction || !isTransactionData(data.transaction)) {
    return (
      <div className="tcv-wrapper">
        <div className="tcv-empty">No transaction data</div>
      </div>
    );
  }
  
  const tx: TransactionData = data.transaction;
  const body = tx.body;
  const witnessSet = tx.witness_set;
  
  const inputCount = body.inputs?.length ?? 0;
  const outputCount = body.outputs?.length ?? 0;
  const certCount = body.certs?.length ?? 0;
  const vkeyCount = witnessSet.vkeys?.length ?? 0;
  const redeemerCount = witnessSet.redeemers?.length ?? 0;
  const plutusScriptCount = witnessSet.plutus_scripts?.length ?? 0;
  const nativeScriptCount = witnessSet.native_scripts?.length ?? 0;
  const bootstrapCount = witnessSet.bootstraps?.length ?? 0;
  const hasMint = body.mint && body.mint.length > 0;
  const hasWithdrawals = body.withdrawals && Object.keys(body.withdrawals).length > 0;
  const hasCollateral = body.collateral && body.collateral.length > 0;
  const hasReferenceInputs = body.reference_inputs && body.reference_inputs.length > 0;
  const hasVotingProcedures = body.voting_procedures && body.voting_procedures.length > 0;
  const hasVotingProposals = body.voting_proposals && body.voting_proposals.length > 0;
  const hasRequiredSigners = body.required_signers && body.required_signers.length > 0;
  const hasAuxiliaryData = !!tx.auxiliary_data;
  
  // Calculate totals for badges
  const bodyItemsCount = inputCount + outputCount + certCount + 
    (hasMint ? body.mint!.length : 0) + 
    (hasCollateral ? body.collateral!.length : 0) +
    (hasReferenceInputs ? body.reference_inputs!.length : 0) +
    (hasWithdrawals ? Object.keys(body.withdrawals!).length : 0) +
    (hasVotingProcedures ? body.voting_procedures!.length : 0) +
    (hasVotingProposals ? body.voting_proposals!.length : 0) +
    (hasRequiredSigners ? body.required_signers!.length : 0);
    
  const witnessItemsCount = vkeyCount + redeemerCount + plutusScriptCount + 
    nativeScriptCount + bootstrapCount +
    (witnessSet.plutus_data?.elems?.length ?? 0);

  return (
    <div className="tcv-wrapper">
      <div className="tcv-container">
        {/* Transaction Summary */}
        <div className="tcv-summary">
          <div className="tcv-summary-hash">
            {data.transaction_hash ? (
              <>
                <span className="tcv-summary-hash-label">TX</span>
                <span className="tcv-summary-hash-value">{data.transaction_hash}</span>
              </>
            ) : (
              <span className="tcv-summary-hash-label">Unsigned Transaction</span>
            )}
          </div>
          <div className="tcv-summary-stats">
            <span className="tcv-summary-stat">{inputCount} inputs</span>
            <span className="tcv-summary-stat">{outputCount} outputs</span>
            <span className="tcv-summary-stat">Fee: ₳ {formatAda(body.fee)}</span>
          </div>
        </div>
        
        {/* Transaction Body Section */}
        <TopLevelSection
          title="Transaction Body"
          icon="📦"
          colorScheme="body"
          badge={bodyItemsCount}
          path="transaction.body"
          diagnosticsMap={diagnosticsMap}
          focusedPath={focusedPath}
        >
          <TransactionDetailsSection
            body={body}
            diagnosticsMap={diagnosticsMap}
            focusedPath={focusedPath}
          />
          
          <SectionCard 
            title="Inputs" 
            icon="📥" 
            colorScheme="blue" 
            badge={inputCount}
            path="transaction.body.inputs"
            diagnosticsMap={diagnosticsMap}
            focusedPath={focusedPath}
          >
            <div className="tcv-items-grid">
              {body.inputs.map((input, i) => (
                <InputCard 
                  key={`${input.transaction_id}#${input.index}`} 
                  input={input} 
                  index={i} 
                  network={network}
                  path={`transaction.body.inputs.${i}`}
                  diagnosticsMap={diagnosticsMap}
                  focusedPath={focusedPath}
                  utxoInfo={inputUtxoInfoMap?.get(`${input.transaction_id}#${input.index}`)}
                />
              ))}
            </div>
          </SectionCard>
          
          <SectionCard 
            title="Outputs" 
            icon="📤" 
            colorScheme="green" 
            badge={outputCount}
            path="transaction.body.outputs"
            diagnosticsMap={diagnosticsMap}
            focusedPath={focusedPath}
          >
            <div className="tcv-items-grid">
              {body.outputs.map((output, i) => (
                <OutputCard 
                  key={i} 
                  output={output} 
                  index={i} 
                  network={network}
                  path={`transaction.body.outputs.${i}`}
                  diagnosticsMap={diagnosticsMap}
                  focusedPath={focusedPath}
                  inlineDatumHash={extractedHashes?.output_inline_datum_hashes?.[i] ?? null}
                  inlineScriptInfo={extractedHashes?.output_inline_scripts?.[i] ?? null}
                />
              ))}
            </div>
          </SectionCard>
          
          {hasMint && (
            <SectionCard 
              title="Minting" 
              icon="🪙" 
              colorScheme="purple" 
              badge={body.mint!.length}
              path="transaction.body.mint"
              diagnosticsMap={diagnosticsMap}
              focusedPath={focusedPath}
            >
              <MintSection 
                mint={body.mint!}
                path="transaction.body.mint"
                diagnosticsMap={diagnosticsMap}
                focusedPath={focusedPath}
              />
            </SectionCard>
          )}
          
          {hasCollateral && (
            <SectionCard 
              title="Collateral" 
              icon="🛡️" 
              colorScheme="orange" 
              badge={body.collateral!.length}
              path="transaction.body.collateral"
              diagnosticsMap={diagnosticsMap}
              focusedPath={focusedPath}
            >
              <div className="tcv-items-grid">
                {body.collateral!.map((input, i) => (
                  <InputCard 
                    key={`${input.transaction_id}#${input.index}`} 
                    input={input} 
                    index={i} 
                    network={network}
                    path={`transaction.body.collateral.${i}`}
                    diagnosticsMap={diagnosticsMap}
                    focusedPath={focusedPath}
                    utxoInfo={inputUtxoInfoMap?.get(`${input.transaction_id}#${input.index}`)}
                  />
                ))}
              </div>
              {body.collateral_return && (
                <div className="tcv-collateral-return">
                  <span className="tcv-subsection-label">Collateral Return</span>
                  <OutputCard 
                    output={body.collateral_return} 
                    index={0} 
                    network={network}
                    path="transaction.body.collateral_return"
                    diagnosticsMap={diagnosticsMap}
                    focusedPath={focusedPath}
                  />
                </div>
              )}
              {body.total_collateral && (
                <div className="tcv-total-collateral">
                  <span className="tcv-item-label">Total Collateral:</span>
                  <span className="tcv-ada-amount">₳ {formatAda(body.total_collateral)}</span>
                </div>
              )}
            </SectionCard>
          )}
          
          {hasReferenceInputs && (
            <SectionCard 
              title="Reference Inputs" 
              icon="🔗" 
              colorScheme="teal" 
              badge={body.reference_inputs!.length}
              path="transaction.body.reference_inputs"
              diagnosticsMap={diagnosticsMap}
              focusedPath={focusedPath}
            >
              <div className="tcv-items-grid">
                {body.reference_inputs!.map((input, i) => (
                  <InputCard 
                    key={`${input.transaction_id}#${input.index}`} 
                    input={input} 
                    index={i} 
                    network={network}
                    path={`transaction.body.reference_inputs.${i}`}
                    diagnosticsMap={diagnosticsMap}
                    focusedPath={focusedPath}
                    utxoInfo={inputUtxoInfoMap?.get(`${input.transaction_id}#${input.index}`)}
                  />
                ))}
              </div>
            </SectionCard>
          )}
          
          {certCount > 0 && (
            <SectionCard 
              title="Certificates" 
              icon="📜" 
              colorScheme="indigo" 
              badge={certCount}
              path="transaction.body.certs"
              diagnosticsMap={diagnosticsMap}
              focusedPath={focusedPath}
            >
              <div className="tcv-items-grid">
                {body.certs!.map((cert, i) => (
                  <CertificateCard
                    key={i}
                    cert={cert}
                    index={i}
                    path={`transaction.body.certs.${i}`}
                    diagnosticsMap={diagnosticsMap}
                    focusedPath={focusedPath}
                  />
                ))}
              </div>
            </SectionCard>
          )}
          
          {hasWithdrawals && (
            <SectionCard 
              title="Withdrawals" 
              icon="💰" 
              colorScheme="pink" 
              badge={Object.keys(body.withdrawals!).length}
              path="transaction.body.withdrawals"
              diagnosticsMap={diagnosticsMap}
              focusedPath={focusedPath}
            >
              <div className="tcv-items-grid">
                {Object.entries(body.withdrawals!).map(([address, amount], i) => (
                  <WithdrawalCard
                    key={address}
                    address={address}
                    amount={amount}
                    index={i}
                    network={network}
                    path={`transaction.body.withdrawals.${i}`}
                    diagnosticsMap={diagnosticsMap}
                    focusedPath={focusedPath}
                  />
                ))}
              </div>
            </SectionCard>
          )}
          
          {hasVotingProcedures && (
            <SectionCard 
              title="Voting Procedures" 
              icon="🗳️" 
              colorScheme="indigo" 
              badge={body.voting_procedures!.length}
              path="transaction.body.voting_procedures"
              diagnosticsMap={diagnosticsMap}
              focusedPath={focusedPath}
            >
              <div className="tcv-items-grid">
                {body.voting_procedures!.map((voterVotes, i) => (
                  <VotingProcedureCard
                    key={i}
                    voterVotes={voterVotes}
                    index={i}
                    path={`transaction.body.voting_procedures.${i}`}
                    diagnosticsMap={diagnosticsMap}
                    focusedPath={focusedPath}
                    network={network}
                  />
                ))}
              </div>
            </SectionCard>
          )}
          
          {hasVotingProposals && (
            <SectionCard 
              title="Voting Proposals" 
              icon="📋" 
              colorScheme="purple" 
              badge={body.voting_proposals!.length}
              path="transaction.body.voting_proposals"
              diagnosticsMap={diagnosticsMap}
              focusedPath={focusedPath}
            >
              <div className="tcv-items-grid">
                {body.voting_proposals!.map((proposal, i) => (
                  <VotingProposalCard
                    key={i}
                    proposal={proposal}
                    index={i}
                    network={network}
                    path={`transaction.body.voting_proposals.${i}`}
                    diagnosticsMap={diagnosticsMap}
                    focusedPath={focusedPath}
                  />
                ))}
              </div>
            </SectionCard>
          )}
          
          {hasRequiredSigners && (
            <SectionCard 
              title="Required Signers" 
              icon="✍️" 
              colorScheme="indigo" 
              badge={body.required_signers!.length}
              path="transaction.body.required_signers"
              diagnosticsMap={diagnosticsMap}
              focusedPath={focusedPath}
            >
              <RequiredSignersCard
                signers={body.required_signers!}
                path="transaction.body.required_signers"
                diagnosticsMap={diagnosticsMap}
                focusedPath={focusedPath}
              />
            </SectionCard>
          )}
        </TopLevelSection>
        
        {/* Witness Set Section */}
        {witnessItemsCount > 0 && (
          <TopLevelSection
            title="Witness Set"
            icon="🔐"
            colorScheme="witness"
            badge={witnessItemsCount}
            path="transaction.witness_set"
            diagnosticsMap={diagnosticsMap}
            focusedPath={focusedPath}
          >
            {vkeyCount > 0 && (
              <SectionCard 
                title="Key Witnesses" 
                icon="🔑" 
                colorScheme="blue" 
                badge={vkeyCount}
                path="transaction.witness_set.vkeys"
                diagnosticsMap={diagnosticsMap}
                focusedPath={focusedPath}
              >
                <div className="tcv-items-grid tcv-vkeys-grid">
                  {witnessSet.vkeys!.map((vkey, i) => (
                    <VKeyCard 
                      key={i} 
                      vkey={vkey} 
                      index={i}
                      path={`transaction.witness_set.vkeys.${i}`}
                      diagnosticsMap={diagnosticsMap}
                      focusedPath={focusedPath}
                    />
                  ))}
                </div>
              </SectionCard>
            )}
            
            {redeemerCount > 0 && (
              <SectionCard 
                title="Redeemers" 
                icon="⚡" 
                colorScheme="orange" 
                badge={redeemerCount}
                path="transaction.witness_set.redeemers"
                diagnosticsMap={diagnosticsMap}
                focusedPath={focusedPath}
              >
                <div className="tcv-items-grid">
                  {witnessSet.redeemers!.map((redeemer, i) => (
                    <RedeemerCard 
                      key={i} 
                      redeemer={redeemer} 
                      path={`transaction.witness_set.redeemers.${i}`}
                      diagnosticsMap={diagnosticsMap}
                      focusedPath={focusedPath}
                    />
                  ))}
                </div>
              </SectionCard>
            )}
            
            {plutusScriptCount > 0 && (
              <SectionCard 
                title="Plutus Scripts" 
                icon="📝" 
                colorScheme="purple" 
                badge={plutusScriptCount}
                path="transaction.witness_set.plutus_scripts"
                diagnosticsMap={diagnosticsMap}
                focusedPath={focusedPath}
                defaultExpanded={true}
              >
                <ScriptsList 
                  scripts={witnessSet.plutus_scripts!}
                  path="transaction.witness_set.plutus_scripts"
                  diagnosticsMap={diagnosticsMap}
                  focusedPath={focusedPath}
                  plutusScriptsInfo={extractedHashes?.witness_plutus_scripts}
                />
              </SectionCard>
            )}
            
            {nativeScriptCount > 0 && (
              <SectionCard 
                title="Native Scripts" 
                icon="📄" 
                colorScheme="teal" 
                badge={nativeScriptCount}
                path="transaction.witness_set.native_scripts"
                diagnosticsMap={diagnosticsMap}
                focusedPath={focusedPath}
                defaultExpanded={true}
              >
                <div className="tcv-items-grid">
                  {witnessSet.native_scripts!.map((script, i) => (
                    <NativeScriptCard 
                      key={i}
                      script={script}
                      index={i}
                      path={`transaction.witness_set.native_scripts.${i}`}
                      diagnosticsMap={diagnosticsMap}
                      focusedPath={focusedPath}
                      scriptHash={extractedHashes?.witness_native_script_hashes?.[i] ?? null}
                    />
                  ))}
                </div>
              </SectionCard>
            )}
            
            {bootstrapCount > 0 && (
              <SectionCard 
                title="Bootstrap Witnesses" 
                icon="🏛️" 
                colorScheme="orange" 
                badge={bootstrapCount}
                path="transaction.witness_set.bootstraps"
                diagnosticsMap={diagnosticsMap}
                focusedPath={focusedPath}
                defaultExpanded={true}
              >
                <div className="tcv-items-grid">
                  {witnessSet.bootstraps!.map((bootstrap, i) => (
                    <BootstrapWitnessCard 
                      key={i}
                      witness={bootstrap}
                      index={i}
                      path={`transaction.witness_set.bootstraps.${i}`}
                      diagnosticsMap={diagnosticsMap}
                      focusedPath={focusedPath}
                    />
                  ))}
                </div>
              </SectionCard>
            )}
            
            {witnessSet.plutus_data && witnessSet.plutus_data.elems.length > 0 && (
              <SectionCard 
                title="Plutus Data" 
                icon="📊" 
                colorScheme="indigo" 
                badge={witnessSet.plutus_data.elems.length}
                path="transaction.witness_set.plutus_data"
                diagnosticsMap={diagnosticsMap}
                focusedPath={focusedPath}
                defaultExpanded={true}
              >
                <PlutusDataList 
                  elems={witnessSet.plutus_data.elems}
                  path="transaction.witness_set.plutus_data.elems"
                  diagnosticsMap={diagnosticsMap}
                  focusedPath={focusedPath}
                  datumHashes={extractedHashes?.witness_datum_hashes}
                />
              </SectionCard>
            )}
          </TopLevelSection>
        )}
        
        {/* Auxiliary Data Section */}
        {hasAuxiliaryData && (
          <TopLevelSection
            title="Auxiliary Data"
            icon="📎"
            colorScheme="auxiliary"
            path="transaction.auxiliary_data"
            diagnosticsMap={diagnosticsMap}
            focusedPath={focusedPath}
            defaultExpanded={true}
          >
            <AuxiliaryDataSection auxData={tx.auxiliary_data!} />
          </TopLevelSection>
        )}
      </div>
    </div>
  );
}

// Helper wrapper components for lists

function ScriptsList({ 
  scripts, 
  path, 
  diagnosticsMap, 
  focusedPath,
  plutusScriptsInfo
}: { 
  scripts: string[]; 
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
  plutusScriptsInfo?: (PlutusScriptInfo | null)[];
}) {
  return (
    <div className="tcv-scripts-list">
      {scripts.map((script, i) => (
        <PlutusScriptCard
          key={i}
          script={script}
          index={i}
          path={path}
          diagnosticsMap={diagnosticsMap}
          focusedPath={focusedPath}
          scriptInfo={plutusScriptsInfo?.[i]}
        />
      ))}
    </div>
  );
}

function PlutusDataList({ 
  elems, 
  path, 
  diagnosticsMap, 
  focusedPath,
  datumHashes
}: { 
  elems: string[]; 
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
  datumHashes?: (string | null)[];
}) {
  return (
    <div className="tcv-data-list">
      {elems.map((datum, i) => (
        <PlutusDataCard
          key={i}
          datum={datum}
          index={i}
          path={path}
          diagnosticsMap={diagnosticsMap}
          focusedPath={focusedPath}
          datumHash={datumHashes?.[i]}
        />
      ))}
    </div>
  );
}

