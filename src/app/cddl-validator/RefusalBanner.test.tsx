import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CborDecodeError } from "@cardananium/cquisitor-lib";
import RefusalBanner from "./RefusalBanner";
import { hexRefusalFor, type HexRefusal } from "./verdict";

const LIMIT = "CBOR nesting is deeper than the supported limit of 16384 levels";

const markup = (refusal: HexRefusal) => renderToStaticMarkup(<RefusalBanner refusal={refusal} />);

/** Decode-error banner via the same `hexRefusalFor` path the UI uses. */
function decodeBanner(error: Partial<CborDecodeError>): string {
  const refusal = hexRefusalFor({
    decodeError: { path: "$", ...error } as CborDecodeError,
    decoderFailure: null,
    outcome: null,
    diagnostics: [],
  });
  expect(refusal).not.toBeNull();
  return markup(refusal!);
}

describe("RefusalBanner", () => {
  test("the decoder's bound is named, with the note that it is a limit", () => {
    const html = decodeBanner({ kind: "nesting_too_deep", message: LIMIT });
    expect(html).toContain('<div class="cq-refusal-banner" role="alert">');
    expect(html).toContain('<span class="cq-refusal-banner-kind">nesting_too_deep</span>');
    expect(html).toContain(LIMIT);
    expect(html).toContain("not a finding about the input");
    expect(html).toContain("The CBOR has to decode before it can be checked against the schema.");
  });

  test("a decode error that is a finding gets no limit note", () => {
    const html = decodeBanner({ kind: "unexpected_eof", message: "unexpected end" });
    expect(html).toContain(">unexpected_eof<");
    expect(html).toContain("unexpected end");
    expect(html).not.toContain("not a finding about the input");
  });

  test("the path is shown only when it is below the root", () => {
    expect(decodeBanner({ kind: "unexpected_eof", message: "cut", path: "$" }))
      .not.toContain("cq-refusal-banner-path");
    const below = decodeBanner({ kind: "unexpected_eof", message: "cut", path: "$.entries[1].value" });
    expect(below).toContain('<code class="cq-refusal-banner-path" title="$.entries[1].value">$.entries[1].value</code>');
  });

  test("a decoder that gave up and a validator that threw say which stopped", () => {
    const decoder = markup(hexRefusalFor({
      decodeError: null, decoderFailure: "wasm trap: unreachable", outcome: null, diagnostics: [],
    })!);
    expect(decoder).toContain(">decoder failed<");
    expect(decoder).toContain("wasm trap: unreachable");
    expect(decoder).toContain("The decoder stopped on this input instead of reporting what was wrong with it.");

    const validator = markup(hexRefusalFor({
      decodeError: null, decoderFailure: null, outcome: { ok: false, error: "worker gone" }, diagnostics: [],
    })!);
    expect(validator).toContain(">validator error<");
    expect(validator).toContain("worker gone");
    expect(validator).toContain("The validator stopped on this input instead of returning a result.");
  });
});
