import { describe, expect, test } from "bun:test";
import { tokenizeCddl } from "./cddlSyntax";

/** The nine `.cq-syntax-*` rules globals.css defines. A class outside this set renders as unstyled text. */
const STYLED_CLASSES = new Set([
  "cq-syntax-comment",
  "cq-syntax-string",
  "cq-syntax-number",
  "cq-syntax-keyword",
  "cq-syntax-prelude",
  "cq-syntax-rule",
  "cq-syntax-ident",
  "cq-syntax-operator",
  "cq-syntax-punctuation",
]);

/** `text` sliced by the token covering `text.indexOf(needle)`, with its class. */
function classOf(text: string, needle: string, ruleNames?: string[]): string | null {
  const at = text.indexOf(needle);
  const token = tokenizeCddl(text, { ruleNames }).find(t => t.start <= at && at < t.end);
  return token?.className ?? null;
}

const CORPUS: Array<[string, string]> = [
  ["empty", ""],
  ["only whitespace", "  \n\t "],
  ["comment only", "; nothing but a comment"],
  ["a whole schema", "; c\nPerson = {\n  name: tstr,\n  ? age: uint,\n}\n"],
  ["no trailing newline", "Person = int"],
  ["CRLF line endings", "Person = {\r\n  name: tstr,\r\n}\r\n"],
  ["unicode in a comment", "; кириллица 🦀\nPerson = int\n"],
  ["a generic rule", "set<a0> = [* a0]\n"],
  ["ranges and choices", "x = 1..10 / 20...30 // y\n"],
  ["stray punctuation", "!!! ??? $$$\n"],
];

describe("tokenizeCddl covers every character", () => {
  for (const [label, text] of CORPUS) {
    test(label, () => {
      const tokens = tokenizeCddl(text);
      let cursor = 0;
      for (const t of tokens) {
        expect(t.start).toBe(cursor);
        expect(t.end).toBeGreaterThan(t.start);
        cursor = t.end;
      }
      expect(cursor).toBe(text.length);
      expect(tokens.map(t => text.slice(t.start, t.end)).join("")).toBe(text);
    });
  }

  test("only classes globals.css styles are emitted", () => {
    for (const [, text] of CORPUS) {
      for (const t of tokenizeCddl(text, { ruleNames: ["Person", "set"] })) {
        if (t.className !== null) expect(STYLED_CLASSES.has(t.className)).toBe(true);
      }
    }
  });

  test("the shared regex does not carry state between calls", () => {
    const a = "Person = int\n";
    const b = "; comment\nOther = tstr\n";
    const first = tokenizeCddl(a);
    tokenizeCddl(b);
    expect(tokenizeCddl(a)).toEqual(first);
    expect(tokenizeCddl(b)).toEqual(tokenizeCddl(b));
  });
});

describe("tokenizeCddl classification", () => {
  test("a comment runs to the end of its line", () => {
    const text = "; comment = int\nPerson = int\n";
    expect(classOf(text, "comment")).toBe("cq-syntax-comment");
    expect(classOf(text, "= int\nPerson")).toBe("cq-syntax-comment");
    expect(classOf(text, "Person")).toBe("cq-syntax-ident");
  });

  test("quoted strings, escapes included", () => {
    expect(classOf('x = "a\\"b"', '"a')).toBe("cq-syntax-string");
    expect(classOf("x = 'raw'", "'raw'")).toBe("cq-syntax-string");
  });

  test("integers, floats, exponents and hex literals", () => {
    expect(classOf("x = 42", "42")).toBe("cq-syntax-number");
    expect(classOf("x = 4.25", "4.25")).toBe("cq-syntax-number");
    expect(classOf("x = 1e10", "1e10")).toBe("cq-syntax-number");
    expect(classOf("x = 0xdeadbeef", "0xdeadbeef")).toBe("cq-syntax-number");
  });

  test("operators", () => {
    for (const op of ["=", "/", "//", "&", "~", "^", "*", "+", "?", "=>", "..", "...", "/=", "//="]) {
      const text = `x ${op} y`;
      expect(classOf(text, op)).toBe("cq-syntax-operator");
    }
  });

  test("brackets and separators are punctuation", () => {
    for (const p of ["{", "}", "[", "]", "(", ")", "<", ">", ",", ":"]) {
      expect(classOf(`x = a ${p} b`, p)).toBe("cq-syntax-punctuation");
    }
  });

  test("known control operators are keywords, unknown dotted names are not", () => {
    expect(classOf("x = tstr .size 4", ".size")).toBe("cq-syntax-keyword");
    expect(classOf("x = tstr .cbor y", ".cbor")).toBe("cq-syntax-keyword");
    expect(classOf("x = tstr .nope y", ".nope")).toBe("cq-syntax-operator");
  });

  test("prelude types beat declared rules, declared rules beat unknown names", () => {
    const text = "uint = int\nPerson = uint\nstranger = x\n";
    const names = ["uint", "Person"];
    // `uint` is declared here and still colours as a prelude type.
    expect(classOf(text, "uint", names)).toBe("cq-syntax-prelude");
    expect(classOf(text, "int\n", names)).toBe("cq-syntax-prelude");
    expect(classOf(text, "Person", names)).toBe("cq-syntax-rule");
    expect(classOf(text, "stranger", names)).toBe("cq-syntax-ident");
  });

  test("with no rule names given, every identifier that isn't prelude is plain", () => {
    expect(classOf("Person = int", "Person")).toBe("cq-syntax-ident");
  });
});

// Tokenizer only paints colours — coverage is asserted above. These pin current mis-colours so extending the pattern is a deliberate change.
describe("tokenizeCddl known gaps", () => {
  test("a tag's `#` is unstyled and its number reads as a float", () => {
    expect(classOf("foo = #6.24(bstr)", "#")).toBeNull();
    expect(classOf("foo = #6.24(bstr)", "6.24")).toBe("cq-syntax-number");
  });

  test("a negative literal's sign is not part of the number", () => {
    expect(classOf("x = -1", "-")).toBeNull();
    expect(classOf("x = -1", "1")).toBe("cq-syntax-number");
  });

  test("a byte-string literal's prefix reads as an identifier", () => {
    expect(classOf("y = h'0102'", "h'")).toBe("cq-syntax-ident");
    expect(classOf("y = h'0102'", "'0102'")).toBe("cq-syntax-string");
    expect(classOf("z = b64'AAAA'", "b64")).toBe("cq-syntax-ident");
  });

  test("a binary literal splits after the leading zero", () => {
    expect(classOf("w = 0b1010", "0b1010")).toBe("cq-syntax-number");
    expect(classOf("w = 0b1010", "b1010")).toBe("cq-syntax-ident");
  });

  test("a dotted identifier is read as a control operator", () => {
    expect(classOf("a = foo.bar", ".bar")).toBe("cq-syntax-operator");
  });

  test("an `@`-prefixed name loses its sigil", () => {
    expect(classOf("b = @x", "@")).toBeNull();
    expect(classOf("b = @x", "x")).toBe("cq-syntax-ident");
  });

  test("RFC 9165 controls beyond .feature are not keywords", () => {
    expect(classOf("c = uint .plus 1", ".plus")).toBe("cq-syntax-operator");
    expect(classOf("c = tstr .cat d", ".cat")).toBe("cq-syntax-operator");
  });
});
