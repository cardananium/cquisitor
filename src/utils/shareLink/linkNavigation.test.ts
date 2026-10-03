import { describe, expect, test } from "bun:test";
import { linkHashOf, opensNewLink } from "./linkNavigation";

describe("linkHashOf", () => {
  test("a hash with parameters is a link", () => {
    expect(linkHashOf("#general-cbor?cbor=83010203")).toBe("#general-cbor?cbor=83010203");
    expect(linkHashOf("#transaction-validator?v=1&e=b&d=abc")).toBe("#transaction-validator?v=1&e=b&d=abc");
    expect(linkHashOf("#json-viewer?title=x&json=%7B%7D")).toBe("#json-viewer?title=x&json=%7B%7D");
  });

  test("bare tabs and empty queries are not links", () => {
    expect(linkHashOf("")).toBeNull();
    expect(linkHashOf("#")).toBeNull();
    expect(linkHashOf("#cddl-validator")).toBeNull();
    expect(linkHashOf("#cddl-validator?")).toBeNull();
  });
});

describe("opensNewLink", () => {
  const A = "#general-cbor?cbor=a1&v=1&e=j&d=AAAA";
  const B = "#cddl-validator?v=1&e=j&d=BBBB";

  test("another link opens", () => {
    expect(opensNewLink(A, B)).toBe(true);
    expect(opensNewLink(null, A)).toBe(true);
    // Same parameters on another tab are another link.
    expect(opensNewLink("#general-cbor?cbor=83", "#cardano-cbor?cbor=83")).toBe(true);
  });

  test("tab switches and returning to the applied link do not", () => {
    expect(opensNewLink(A, "#cddl-validator")).toBe(false);
    expect(opensNewLink(A, "")).toBe(false);
    expect(opensNewLink(null, "#general-cbor")).toBe(false);
    expect(opensNewLink(A, A)).toBe(false);
  });
});
