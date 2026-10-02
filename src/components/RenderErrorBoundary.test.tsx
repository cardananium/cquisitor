import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import { RenderErrorBoundary } from "./RenderErrorBoundary";
import { installMiniDom, reactPropsOf, type MiniDocument, type MiniElement } from "./miniDomForTests";

const FAILURE = "Invalid mix of BigInt and other type in division.";

/** Throws while `fail` says so, like a formatter handed a value it cannot format. */
function Formatter({ fail }: { fail: () => boolean }) {
  if (fail()) throw new TypeError(FAILURE);
  return <span>formatted</span>;
}

let dom: { document: MiniDocument; uninstall: () => void };
let createRoot: typeof import("react-dom/client").createRoot;
let root: Root | null = null;
let container: MiniElement;
let caught: unknown[];
let uncaught: unknown[];

beforeAll(async () => {
  dom = installMiniDom();
  ({ createRoot } = await import("react-dom/client"));
});
afterAll(() => dom.uninstall());
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
});

async function mount(element: React.ReactNode): Promise<void> {
  container = dom.document.createElement("div");
  caught = [];
  uncaught = [];
  root = createRoot(container as unknown as Element, {
    onCaughtError: (error) => caught.push(error),
    onUncaughtError: (error) => uncaught.push(error),
  });
  await quietly(() => root!.render(element));
}

/** Runs a React update with console.error muted (React logs every caught failure). */
async function quietly(update: () => void): Promise<void> {
  const original = console.error;
  console.error = () => {};
  try {
    await act(async () => update());
  } finally {
    console.error = original;
  }
}

/** A page with its own state (the pasted input) around a boundary. */
function Page({ run, failOnRun, tick = 0 }: { run: number; failOnRun: number; tick?: number }) {
  const [input, setInput] = useState("");
  return (
    <div data-tick={tick}>
      <button className="paste" onClick={() => setInput("84a400d9010281825820…")}>
        paste
      </button>
      <span>input: {input}</span>
      <RenderErrorBoundary what="the validation result" variant="panel" resetKeys={[run]}>
        <Formatter fail={() => run === failOnRun} />
      </RenderErrorBoundary>
    </div>
  );
}

describe("RenderErrorBoundary", () => {
  test("a failing subtree is replaced by the fallback and the page keeps its state", async () => {
    await mount(<Page run={0} failOnRun={1} />);
    await quietly(() => (reactPropsOf(container.findByClass("paste")[0])!.onClick as () => void)());
    expect(container.textContent).toBe("pasteinput: 84a400d9010281825820…formatted");

    await quietly(() => root!.render(<Page run={1} failOnRun={1} />));
    expect(uncaught).toHaveLength(0);
    expect(caught).toHaveLength(1);
    expect(container.textContent).toBe(
      `pasteinput: 84a400d9010281825820…Could not display the validation result.${FAILURE}Try again`,
    );
    expect(container.findByClass("render-error-panel")[0].getAttribute("role")).toBe("alert");
  });

  test("new reset keys clear the error; unchanged ones keep the fallback", async () => {
    await mount(<Page run={0} failOnRun={0} />);
    expect(container.textContent).toContain("Could not display the validation result.");

    // A parent re-render with the same key values keeps the fallback.
    await quietly(() => root!.render(<Page run={0} failOnRun={-1} tick={1} />));
    expect(container.textContent).toContain("Could not display the validation result.");

    // A new result (new key) renders the children again.
    await quietly(() => root!.render(<Page run={1} failOnRun={-1} />));
    expect(container.textContent).toBe("pasteinput: formatted");
    expect(caught).toHaveLength(1);
    expect(uncaught).toHaveLength(0);
  });

  test("a key change that itself fails is caught once, without a retry loop", async () => {
    await mount(<Page run={0} failOnRun={1} />);
    await quietly(() => root!.render(<Page run={1} failOnRun={1} />));
    expect(container.textContent).toContain("Could not display the validation result.");
    expect(caught).toHaveLength(1);
    expect(uncaught).toHaveLength(0);
  });

  test("Try again renders the children again", async () => {
    let failing = true;
    await mount(
      <RenderErrorBoundary what="the result" variant="panel">
        <Formatter fail={() => failing} />
      </RenderErrorBoundary>,
    );
    const retry = container.findByClass("render-error-panel-retry")[0];
    failing = false;
    await quietly(() => (reactPropsOf(retry)!.onClick as () => void)());
    expect(container.textContent).toBe("formatted");
  });

  test("the inline variant is a one-line note", async () => {
    await mount(
      <div>
        <span>fee: </span>
        <RenderErrorBoundary what="this value" variant="inline">
          <Formatter fail={() => true} />
        </RenderErrorBoundary>
      </div>,
    );
    expect(container.textContent).toBe(`fee: Could not display this value: ${FAILURE}`);
    expect(container.findByClass("render-error-inline")).toHaveLength(1);
  });
});
