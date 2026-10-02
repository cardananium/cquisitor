import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { NativeScript } from "@cardananium/cquisitor-lib";
import { NativeScriptCard } from "./components/NativeScriptCard";
import { NATIVE_SCRIPT_DRAW_DEPTH, nativeScriptDepth } from "./utils";

/** `levels` nested ScriptAll levels over one pubkey leaf. */
function deepScript(levels: number): NativeScript {
  let script: NativeScript = { ScriptPubkey: { addr_keyhash: "11".repeat(28) } };
  for (let i = 0; i < levels; i++) script = { ScriptAll: { native_scripts: [script] } };
  return script;
}

describe("deep native scripts", () => {
  test("depth is measured without recursion", () => {
    expect(nativeScriptDepth(deepScript(0))).toBe(1);
    expect(nativeScriptDepth(deepScript(100_000))).toBe(100_001);
  });

  test("the card draws a bounded number of levels and names the rest", () => {
    const html = renderToStaticMarkup(
      <NativeScriptCard script={deepScript(10_000)} index={0} path="p" diagnosticsMap={new Map()} />,
    );
    expect(html.split("ALL (1)").length - 1).toBe(NATIVE_SCRIPT_DRAW_DEPTH);
    expect(html).toContain(`${(10_001 - NATIVE_SCRIPT_DRAW_DEPTH).toLocaleString("en-US")} more levels not drawn`);
  });
});
