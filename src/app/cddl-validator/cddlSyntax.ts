// Lightweight CDDL tokenizer for editor syntax highlighting.
// Produces a flat list of non-overlapping `[start, end, className]` tuples
// covering every char of the input (whitespace tokens carry no class).
// The classes line up with `.cq-syntax-*` rules in globals.css.

export type SyntaxToken = { start: number; end: number; className: string | null };

const KEYWORDS = new Set([
  // type/group operators (control words from RFC 8610 + extras)
  ".size", ".bits", ".regexp", ".pcre", ".cbor", ".cborseq",
  ".within", ".and", ".lt", ".le", ".gt", ".ge", ".eq", ".ne",
  ".default", ".feature",
]);

// Standard prelude type names — anything from RFC 8610 §D plus a few
// commonly-used extensions (Cardano CDDL leans on these heavily).
const PRELUDE = new Set([
  "any", "uint", "nint", "int", "bstr", "bytes", "tstr", "text",
  "tdate", "time", "number", "biguint", "bignint", "bigint", "integer",
  "unsigned", "decfrac", "bigfloat", "eb64url", "eb64legacy", "eb16",
  "encoded-cbor", "uri", "b64url", "b64legacy", "regexp", "mime-message",
  "cbor-any", "float16", "float32", "float64", "float16-32", "float32-64",
  "float", "false", "true", "bool", "nil", "null", "undefined",
]);

const OPERATORS = new Set([
  "=", "/", "//", "&", "~", "^", "*", "+", "?",
  "=>", "..", "...", "/=", "//=",
]);

// One regex tries to be generous: it tokens the whole document into
// comment / string / number / dotted-control / multi-char operators /
// punctuation / identifier / whitespace, with a final catch-all so no
// character is ever skipped (otherwise gaps shift the syntax overlay
// out of sync with the textarea).
const TOKEN_RE =
  /;[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|0[xX][0-9a-fA-F]+|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\.\.\.|\.\.|=>|\/=|\/\/=|\/\/|\.[A-Za-z][A-Za-z0-9_-]*|[\^=&~*+?:,()\[\]{}<>]|\/|[A-Za-z_$][\w$-]*|[ \t\r\n]+|[^\s]/g;

export interface TokenizeOptions {
  /** Names declared in this CDDL — used to colour rule references. */
  ruleNames?: ReadonlyArray<string>;
}

export function tokenizeCddl(text: string, opts: TokenizeOptions = {}): SyntaxToken[] {
  const ruleSet = opts.ruleNames ? new Set(opts.ruleNames) : null;
  const out: SyntaxToken[] = [];
  let cursor = 0;

  // Reset regex.lastIndex on every call for safety with the global flag.
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const tok = m[0];
    const start = m.index;
    const end = start + tok.length;

    // Cover any gaps the regex skipped (shouldn't happen with this pattern,
    // but be defensive — emit unclassified spans).
    if (start > cursor) out.push({ start: cursor, end: start, className: null });
    cursor = end;

    let cls: string | null = null;
    const first = tok.charCodeAt(0);

    if (first === 0x3b /* ; */) cls = "cq-syntax-comment";
    else if (first === 0x22 /* " */ || first === 0x27 /* ' */) cls = "cq-syntax-string";
    else if ((first >= 0x30 && first <= 0x39) /* digit */) cls = "cq-syntax-number";
    else if (first === 0x2e /* . */) {
      // .cbor / .size / etc — keyword-like control operators.
      cls = KEYWORDS.has(tok) ? "cq-syntax-keyword" : "cq-syntax-operator";
    } else if (OPERATORS.has(tok)) cls = "cq-syntax-operator";
    else if (
      tok === "{" || tok === "}" || tok === "[" || tok === "]" ||
      tok === "(" || tok === ")" || tok === "<" || tok === ">"
    ) cls = "cq-syntax-punctuation";
    else if (tok === "," || tok === ":") cls = "cq-syntax-punctuation";
    else if (/^[A-Za-z_$][\w$-]*$/.test(tok)) {
      if (PRELUDE.has(tok)) cls = "cq-syntax-prelude";
      else if (ruleSet && ruleSet.has(tok)) cls = "cq-syntax-rule";
      else cls = "cq-syntax-ident";
    } else if (/^[ \t\r\n]+$/.test(tok)) cls = null;

    out.push({ start, end, className: cls });
  }

  if (cursor < text.length) out.push({ start: cursor, end: text.length, className: null });
  return out;
}
