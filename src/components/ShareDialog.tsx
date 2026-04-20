"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CheckIcon, CopyIcon, SpinnerIcon, WarningIcon } from "./Icons";
import {
  encodeValidatorLink,
  encodeCardanoCborLink,
  encodeGeneralCborLink,
  getBuildLinkOpts,
  type ShareLinkMode,
  type ValidatorShareInput,
  type CardanoCborShareInput,
  type GeneralCborShareInput,
} from "@/utils/shareLink";

const URL_WARN_THRESHOLD = 4096;

export type ShareDialogInput =
  | { kind: "validator"; input: ValidatorShareInput }
  | { kind: "cardano-cbor"; input: CardanoCborShareInput }
  | { kind: "general-cbor"; input: GeneralCborShareInput };

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ShareDialogInput;
}

type ModeKind = "compressed" | "readable" | "minimal";

function formatByteCount(n: number): string {
  if (n < 1024) return `${n} chars`;
  return `${(n / 1024).toFixed(1)} KB`;
}

export default function ShareDialog({ open, onOpenChange, target }: ShareDialogProps) {
  const hasCtx = target.kind === "validator" && !!target.input.ctx;
  const pageHasCompressibleState = target.kind !== "general-cbor" || target.input.cbor.length > 200;

  const [mode, setMode] = useState<ModeKind>(() => (hasCtx ? "compressed" : "minimal"));
  const [includeCtx, setIncludeCtx] = useState<boolean>(() => hasCtx);
  const [urlState, setUrlState] = useState<
    | { status: "encoding" }
    | { status: "ok"; url: string }
    | { status: "error"; message: string }
  >({ status: "encoding" });
  const [copied, setCopied] = useState(false);

  const shareMode: ShareLinkMode = useMemo(() => {
    if (mode === "compressed") return { kind: "compressed" };
    if (mode === "readable") return { kind: "readable" };
    return { kind: "minimal" };
  }, [mode]);

  // Recompute URL whenever options change. Legitimate effect: synchronising
  // React state with the async brotli worker / encoder output.
  useEffect(() => {
    let cancelled = false;
    const opts = getBuildLinkOpts();
    const run = async (): Promise<string> => {
      switch (target.kind) {
        case "validator":
          return encodeValidatorLink(opts, target.input, shareMode, includeCtx);
        case "cardano-cbor":
          return encodeCardanoCborLink(opts, target.input, shareMode);
        case "general-cbor":
          return encodeGeneralCborLink(opts, target.input, shareMode);
      }
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrlState((prev) => (prev.status === "ok" ? prev : { status: "encoding" }));

    run()
      .then((url) => {
        if (!cancelled) setUrlState({ status: "ok", url });
      })
      .catch((e) => {
        if (!cancelled) {
          setUrlState({
            status: "error",
            message: e instanceof Error ? e.message : "Failed to encode link",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [target, shareMode, includeCtx]);

  const url = urlState.status === "ok" ? urlState.url : "";
  const encoding = urlState.status === "encoding";
  const encodeError = urlState.status === "error" ? urlState.message : null;

  const handleCopy = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback — select text for manual copy
      setCopied(false);
    }
  }, [url]);

  const byteLen = url.length;
  const overThreshold = byteLen > URL_WARN_THRESHOLD;

  const compressionDisabled = target.kind === "validator" && !includeCtx;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="share-dialog-overlay" />
        <Dialog.Content className="share-dialog-content">
          <Dialog.Title className="share-dialog-title">Share link</Dialog.Title>
          <Dialog.Description className="share-dialog-description">
            Choose how to encode the link. Third-party tools can use the minimal format by
            concatenating <code>cbor=&lt;hex&gt;</code> onto the base URL.
          </Dialog.Description>

          <div className="share-dialog-body">
            <fieldset className="share-dialog-section">
              <legend className="share-dialog-legend">Link style</legend>

              <label
                className={`share-dialog-option ${compressionDisabled ? "disabled" : ""}`}
                title={compressionDisabled ? "Not useful without context" : undefined}
              >
                <input
                  type="radio"
                  name="share-mode"
                  value="compressed"
                  checked={mode === "compressed"}
                  onChange={() => setMode("compressed")}
                  disabled={compressionDisabled && !pageHasCompressibleState}
                />
                <div className="share-dialog-option-body">
                  <div className="share-dialog-option-title">Compressed</div>
                  <div className="share-dialog-option-hint">
                    Brotli-compressed. Smallest link.
                  </div>
                </div>
              </label>

              <label
                className={`share-dialog-option ${compressionDisabled ? "disabled" : ""}`}
                title={compressionDisabled ? "Not useful without context" : undefined}
              >
                <input
                  type="radio"
                  name="share-mode"
                  value="readable"
                  checked={mode === "readable"}
                  onChange={() => setMode("readable")}
                  disabled={compressionDisabled && !pageHasCompressibleState}
                />
                <div className="share-dialog-option-body">
                  <div className="share-dialog-option-title">Uncompressed</div>
                  <div className="share-dialog-option-hint">
                    Raw JSON (base64url). Longer, human-auditable.
                  </div>
                </div>
              </label>

              <label className="share-dialog-option">
                <input
                  type="radio"
                  name="share-mode"
                  value="minimal"
                  checked={mode === "minimal"}
                  onChange={() => setMode("minimal")}
                />
                <div className="share-dialog-option-body">
                  <div className="share-dialog-option-title">Minimal (third-party style)</div>
                  <div className="share-dialog-option-hint">
                    Raw query params (<code>cbor</code>, <code>net</code>, …). Anyone can build
                    this URL by hand.
                  </div>
                </div>
              </label>
            </fieldset>

            {target.kind === "validator" && hasCtx && (
              <div className="share-dialog-section">
                <label className="share-dialog-checkbox">
                  <input
                    type="checkbox"
                    checked={includeCtx}
                    onChange={(e) => setIncludeCtx(e.target.checked)}
                  />
                  <div>
                    <div className="share-dialog-option-title">Include validation context</div>
                    <div className="share-dialog-option-hint">
                      Saves UTxOs, protocol params, accounts, DReps, pools, gov actions. The
                      opened link can validate without hitting Koios.
                    </div>
                  </div>
                </label>
              </div>
            )}

            <div className="share-dialog-preview">
              <div className="share-dialog-preview-meta">
                <span>
                  {encoding ? (
                    <>
                      <SpinnerIcon size={12} className="animate-spin" /> Encoding…
                    </>
                  ) : (
                    <>Length: {formatByteCount(byteLen)}</>
                  )}
                </span>
                {overThreshold && !encoding && (
                  <span className="share-dialog-warn">
                    <WarningIcon size={12} className="text-yellow-600" />
                    Long URL — some chat platforms may truncate.
                  </span>
                )}
              </div>
              {encodeError ? (
                <div className="share-dialog-error">{encodeError}</div>
              ) : (
                <textarea
                  readOnly
                  className="share-dialog-url"
                  value={url}
                  rows={4}
                  spellCheck={false}
                  onFocus={(e) => e.currentTarget.select()}
                />
              )}
            </div>
          </div>

          <div className="share-dialog-footer">
            <Dialog.Close asChild>
              <button type="button" className="share-dialog-btn share-dialog-btn-ghost">
                Close
              </button>
            </Dialog.Close>
            <button
              type="button"
              className={`share-dialog-btn share-dialog-btn-primary ${copied ? "copied" : ""}`}
              disabled={encoding || !url || !!encodeError}
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <CheckIcon size={12} />
                  Copied
                </>
              ) : (
                <>
                  <CopyIcon size={12} />
                  Copy link
                </>
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
