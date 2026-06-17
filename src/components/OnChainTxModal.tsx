"use client";

import { useEffect, useRef, useState } from "react";
import type { DataProvider } from "@/utils/transactionValidation";
import { fetchTxCbor } from "@/utils/transactionValidation";
import type { NetworkType } from "@cardananium/cquisitor-lib";

interface OnChainTxModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the fetched raw tx CBOR (hex) once loaded. */
  onLoaded: (cbor: string) => void;
  provider: DataProvider;
  network: NetworkType;
  apiKey: string;
}

export default function OnChainTxModal({
  isOpen,
  onClose,
  onLoaded,
  provider,
  network,
  apiKey,
}: OnChainTxModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [hash, setHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providerLabel = provider === "blockfrost" ? "Blockfrost" : "Koios";
  const needsKey = provider === "blockfrost" && !apiKey.trim();

  // Reset + focus when opened.
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }
  }, [isOpen, onClose, loading]);

  // Close on click outside.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!loading && modalRef.current && !modalRef.current.contains(e.target as Node)) onClose();
    };
    if (isOpen) {
      document.addEventListener("mousedown", onClick);
      return () => document.removeEventListener("mousedown", onClick);
    }
  }, [isOpen, onClose, loading]);

  if (!isOpen) return null;

  const submit = async () => {
    if (loading) return;
    setError(null);
    if (needsKey) {
      setError(`Enter a ${providerLabel} API key in the form above first.`);
      return;
    }
    setLoading(true);
    try {
      const cbor = await fetchTxCbor(hash, { provider, network, apiKey: apiKey.trim() || undefined });
      onLoaded(cbor);
      setHash("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content onchain-tx-modal" ref={modalRef}>
        <div className="modal-header">
          <h3>Load on-chain transaction</h3>
          <button onClick={onClose} className="modal-close" aria-label="Close" disabled={loading}>
            ✕
          </button>
        </div>
        <p className="modal-description">
          Fetch a transaction&apos;s CBOR by hash from <strong>{providerLabel}</strong> on{" "}
          <strong>{network}</strong>, then decode &amp; validate it here.
        </p>
        <div className="onchain-tx-field">
          <label className="onchain-tx-label">Transaction hash</label>
          <input
            ref={inputRef}
            type="text"
            className="onchain-tx-input"
            placeholder="64-char hex tx hash (e.g. 84ac0083…)"
            value={hash}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setHash(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            disabled={loading}
          />
        </div>
        {error && <div className="onchain-tx-error">{error}</div>}
        <div className="onchain-tx-actions">
          <button className="onchain-tx-cancel" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="onchain-tx-submit" onClick={submit} disabled={loading || !hash.trim()}>
            {loading ? "Loading…" : "Load transaction"}
          </button>
        </div>
      </div>
    </div>
  );
}
