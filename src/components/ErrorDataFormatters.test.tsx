import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseJsonExact } from "@cardananium/cquisitor-lib";
import {
  ErrorDataDetails,
  ErrorFormatter,
  formatInteger,
  formatLovelace,
  getCleanedErrorMessage,
  getHumanReadableMessage,
} from "./ErrorDataFormatters";
import { installMiniDom, type MiniDocument, type MiniElement } from "./miniDomForTests";

// Validation results are read with parseJsonExact: integers past 2^53 arrive as
// bigint. These payloads are the library's JSON for such results.

/** ValueNotConservedUTxO for a transaction whose output holds 2^60 + 206625 lovelace. */
const VALUE_NOT_CONSERVED_JSON = `{
  "ValueNotConservedUTxO": {
    "input_sum": {
      "assets": { "assets": [ { "policy_id": "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6", "asset_name": "4d494e", "quantity": 50000000000 } ] },
      "coins": 4000000
    },
    "output_sum": {
      "assets": { "assets": [ { "policy_id": "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6", "asset_name": "4d494e", "quantity": 50000000000 } ] },
      "coins": 1152921504607053601
    },
    "difference": { "assets": { "assets": [] }, "coins": -1152921504603053601 }
  }
}`;

const FEE_TOO_SMALL_JSON = `{
  "FeeTooSmallUTxO": {
    "actual_fee": 18446744073709551615,
    "min_fee": 206757,
    "fee_decomposition": { "txSizeFee": 18446744073709551000, "referenceScriptsFee": 0, "executionUnitsFee": 615 }
  }
}`;

const BUDGET_BIGGER_JSON = `{
  "BudgetIsBiggerThanExpected": {
    "expected_budget": { "mem": 1700, "steps": 476468 },
    "actual_budget": { "mem": 9007199254740993, "steps": 18446744073709551615 }
  }
}`;

/** The `{ ErrorType: data }` payload split the way the validator page splits it. */
function errorPayload(json: string): { errorType: string; errorData: Record<string, unknown> } {
  const parsed = parseJsonExact<Record<string, Record<string, unknown>>>(json);
  const [errorType] = Object.keys(parsed);
  return { errorType, errorData: parsed[errorType] };
}

/** Visible text of server-rendered markup, whitespace collapsed. */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

const DECIMAL = new Intl.NumberFormat().formatToParts(1.5).find((p) => p.type === "decimal")!.value;
const grouped = (digits: string) => BigInt(digits).toLocaleString();

describe("formatLovelace", () => {
  test("is exact beyond 2^53", () => {
    // As a double this amount is 1152921504607.0535: the last digits are lost.
    expect(formatLovelace(BigInt("1152921504607053601"))).toBe(
      `₳ ${grouped("1152921504607")}${DECIMAL}053601`,
    );
    expect(formatLovelace(BigInt("-1152921504603053601"))).toBe(
      `₳ -${grouped("1152921504603")}${DECIMAL}053601`,
    );
    expect(formatLovelace(BigInt("18446744073709551615"), true)).toBe(
      `${grouped("18446744073709551615")} lovelace`,
    );
  });

  test("matches the number formatting for safe amounts", () => {
    const asAda = (lovelace: number) =>
      `₳ ${(lovelace / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
    for (const lovelace of [0, 1, 10, 1_000_000, 1_500_000, 1_234_567, 45_000_000_000_000, -2_000_000, -1]) {
      expect(formatLovelace(lovelace)).toBe(asAda(lovelace));
      expect(formatLovelace(BigInt(lovelace))).toBe(asAda(lovelace));
      expect(formatLovelace(lovelace, true)).toBe(`${lovelace.toLocaleString()} lovelace`);
    }
  });

  test("formatInteger is exact for bigint and unchanged for numbers", () => {
    expect(formatInteger(BigInt("18446744073709551615"))).toBe(grouped("18446744073709551615"));
    expect(formatInteger(476468)).toBe((476468).toLocaleString());
  });
});

describe("validation results with integers beyond 2^53", () => {
  test("a Value whose coins exceed 2^53 renders with the exact amount", () => {
    const { errorType, errorData } = errorPayload(VALUE_NOT_CONSERVED_JSON);
    expect(typeof (errorData.output_sum as { coins: unknown }).coins).toBe("bigint");

    const text = textOf(renderToStaticMarkup(<ErrorDataDetails error={errorData} />));
    expect(text).toContain(`output sum: ADA: ₳ ${grouped("1152921504607")}${DECIMAL}053601`);
    expect(text).toContain(`difference: ADA: ₳ -${grouped("1152921504603")}${DECIMAL}053601`);
    expect(text).toContain(`input sum: ADA: ₳ 4${DECIMAL}00`);
    expect(text).not.toContain("Could not display");

    expect(getCleanedErrorMessage("Value not conserved. Inputs: …", errorType, errorData)).toBe(
      "Value not conserved",
    );
  });

  test("the diagnostic tooltip renders the same data", () => {
    const { errorType, errorData } = errorPayload(VALUE_NOT_CONSERVED_JSON);
    const html = renderToStaticMarkup(
      <ErrorFormatter error={errorData} errorType={errorType} message="Value not conserved" />,
    );
    expect(textOf(html)).toContain(`₳ ${grouped("1152921504607")}${DECIMAL}053601`);
  });

  test("fee decomposition and fee message stay exact", () => {
    const { errorType, errorData } = errorPayload(FEE_TOO_SMALL_JSON);
    expect(typeof errorData.actual_fee).toBe("bigint");

    const text = textOf(renderToStaticMarkup(<ErrorDataDetails error={errorData} />));
    expect(text).toContain(`TX Size: ${grouped("18446744073709551000")} lovelace (100.0%)`);
    expect(text).toContain("Execution: 615 lovelace (0.0%)");
    expect(text).toContain(`Total: ${grouped("18446744073709551615")} lovelace`);

    expect(getHumanReadableMessage(errorType, errorData)).toBe(
      `Fee too small: ${grouped("18446744073709551615")} < ${grouped("206757")} lovelace required`,
    );
  });

  test("a zero fee decomposition shows 0.0% shares", () => {
    const text = textOf(
      renderToStaticMarkup(
        <ErrorDataDetails
          error={{ fee_decomposition: { txSizeFee: 0, referenceScriptsFee: 0, executionUnitsFee: 0 } }}
        />,
      ),
    );
    expect(text).toContain("TX Size: 0 lovelace (0.0%)");
    expect(text).not.toContain("NaN");
  });

  test("budget comparison subtracts exactly", () => {
    const { errorData } = errorPayload(BUDGET_BIGGER_JSON);
    const text = textOf(renderToStaticMarkup(<ErrorDataDetails error={errorData} />));
    expect(text).toContain(
      `Memory: ${grouped("9007199254740993")} → ${grouped("1700")} (+${grouped("9007199254739293")})`,
    );
    expect(text).toContain(
      `CPU: ${grouped("18446744073709551615")} → ${grouped("476468")} (+${grouped("18446744073709075147")})`,
    );
  });

  test("ex units, protocol versions and governance action ids accept bigint", () => {
    const huge = BigInt("18446744073709551615");
    const text = textOf(
      renderToStaticMarkup(
        <ErrorDataDetails
          error={{
            units: { mem: huge, steps: 5 },
            version: { major: huge, minor: 0 },
            action: { txHash: [0xab, 0xcd], index: huge },
          }}
        />,
      ),
    );
    expect(text).toContain(`Memory: ${grouped("18446744073709551615")} units`);
    expect(text).toContain(`v18446744073709551615.0`);
    expect(text).toContain(`abcd # 18446744073709551615`);
  });
});

describe("render failures stay inside the value that failed", () => {
  let dom: { document: MiniDocument; uninstall: () => void };
  let createRoot: typeof import("react-dom/client").createRoot;

  beforeAll(async () => {
    dom = installMiniDom();
    ({ createRoot } = await import("react-dom/client"));
  });
  afterAll(() => dom.uninstall());

  test("one unformattable value leaves the others and the diagnostic in place", async () => {
    const container = dom.document.createElement("div");
    const caught: unknown[] = [];
    const root = createRoot(container as unknown as Element, {
      onCaughtError: (error) => caught.push(error),
    });
    const { errorData } = errorPayload(VALUE_NOT_CONSERVED_JSON);
    // A fractional asset quantity cannot become a bigint: the Value formatter throws.
    const broken = {
      ...errorData,
      output_sum: {
        coins: 1,
        assets: { assets: [{ policy_id: "00".repeat(28), asset_name: "", quantity: 1.5 }] },
      },
    };

    const quietConsole = console.error;
    console.error = () => {};
    try {
      await act(async () => root.render(<ErrorDataDetails error={broken} />));
    } finally {
      console.error = quietConsole;
    }

    expect(caught).toHaveLength(1);
    const text = (container as MiniElement).textContent;
    expect(text).toContain("output sum:Could not display this value:");
    expect(text).toContain(`input sum:ADA:₳ 4${DECIMAL}00`);
    expect(text).toContain(`difference:ADA:₳ -${grouped("1152921504603")}${DECIMAL}053601`);
    await act(async () => root.unmount());
  });
});

describe("DisallowedVoters", () => {
  const TX_HASH = "39b20e86e99b84e032e15e5006c483bdd13e457e96ba6f0302339c59046f9c6e";
  const ACTION_ID = "gov_action18xeqaphfnwzwqvhptegqd3yrhhgnu3t7j6ax7qczxww9jpr0n3hqqfer9wd";
  const errorData = {
    disallowed_pairs: [
      [
        { stakingPoolKeyHash: "47114b23b4a237806f6cf1d2291c53dc26f1c1d16ced00db06736dc4" },
        { txHash: Array.from(Buffer.from(TX_HASH, "hex")), index: 0 },
      ],
    ],
  };

  test("the header names the voter; no byte list", () => {
    const message = getCleanedErrorMessage("Voters not allowed: [(StakingPoolKeyHash(\"47\"), GovernanceActionId { tx_hash: [57, 178], index: 0 })]", "DisallowedVoters", errorData);
    expect(message).toStartWith("Stake pool pool1");
    expect(message).toEndWith("may not vote on this governance action");
    expect(message).not.toContain("tx_hash");
  });

  test("the details show the action as CIP-129, linked to Cardanoscan of the network", () => {
    const html = renderToStaticMarkup(<ErrorDataDetails error={errorData} network="preview" />);
    expect(html).toContain(`href="https://preview.cardanoscan.io/govAction/${ACTION_ID}"`);
    expect(textOf(html)).toContain(ACTION_ID);
    expect(textOf(html)).toContain(TX_HASH);
  });

  test("without a network the id is shown, not linked", () => {
    const html = renderToStaticMarkup(<ErrorDataDetails error={errorData} />);
    expect(html).not.toContain("<a ");
    expect(textOf(html)).toContain(ACTION_ID);
  });
});

