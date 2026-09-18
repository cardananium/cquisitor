import { describe, expect, test } from "bun:test";
import type { LibRequest, LibResponse } from "./protocol";
import { answer, reply, type LibModule } from "./workerCore";

const request = (fn: LibRequest["fn"], ...args: unknown[]): LibRequest => ({
  id: 7,
  gen: 0,
  fn,
  args,
});

const libOf = (exports: LibModule) => () => Promise.resolve(exports);

describe("answering a request", () => {
  test("a document walker's text is posted as text, unparsed", async () => {
    const lib = libOf({ cbor_to_json: () => '{"ok":true,"value":5}' });
    expect(await answer(request("cbor_to_json", "05"), lib)).toEqual({
      id: 7,
      gen: 0,
      ok: true,
      json: '{"ok":true,"value":5}',
    });
  });

  test("a document walker that did not answer in text is reported, not forwarded", async () => {
    const lib = libOf({ cbor_to_json: () => ({ ok: true, value: 5 }) });
    const response = await answer(request("cbor_to_json", "05"), lib);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.message).toContain("something other than JSON text");
      expect(response.error.fatal).toBe(false);
    }
  });

  test("an object answer is converted in the worker", async () => {
    const lib = libOf({
      cddl_outline: () => [{ name: "a", span: { "$serde_json::private::Number": "3" } }],
    });
    expect(await answer(request("cddl_outline", "a = int"), lib)).toEqual({
      id: 7,
      gen: 0,
      ok: true,
      value: [{ name: "a", span: 3 }],
    });
  });

  test("a stack overflow inside the call is fatal to the instance", async () => {
    const lib = libOf({
      cbor_to_json: () => {
        throw new RangeError("Maximum call stack size exceeded");
      },
    });
    const response = await answer(request("cbor_to_json", "05"), lib);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.name).toBe("RangeError");
      expect(response.error.fatal).toBe(true);
    }
  });

  test("a throw that is neither a trap nor an overflow keeps the instance", async () => {
    const lib = libOf({
      cddl_format: () => {
        throw new Error("parse error");
      },
    });
    const response = await answer(request("cddl_format", "a = {"), lib);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.fatal).toBe(false);
  });

  test("a name off the allowlist never reaches the module", async () => {
    let loaded = false;
    const lib = () => {
      loaded = true;
      return Promise.resolve({});
    };
    const response = await answer(request("constructor" as LibRequest["fn"]), lib);
    expect(response.ok).toBe(false);
    expect(loaded).toBe(false);
  });
});

describe("posting a reply", () => {
  test("an answer the clone refuses is replaced by a refusal that names the kind", () => {
    const posted: LibResponse[] = [];
    let attempts = 0;
    const post = (message: LibResponse) => {
      attempts++;
      if (attempts === 1) throw new DOMException("too deep", "DataCloneError");
      posted.push(message);
    };
    reply({ id: 7, gen: 0, ok: true, value: { deep: true } }, post);
    expect(posted.length).toBe(1);
    const only = posted[0];
    expect(only.ok).toBe(false);
    if (!only.ok) {
      expect(only.error.kind).toBe("result_not_transferable");
      expect(only.error.fatal).toBe(false);
      expect(only.error.message).toContain("could not be handed to the page");
      expect(only.error.message).toContain("too deep");
    }
    expect(only.id).toBe(7);
  });

  test("an answer that posts is posted once, as it is", () => {
    const posted: LibResponse[] = [];
    const response: LibResponse = { id: 7, gen: 0, ok: true, json: "[]" };
    reply(response, (m) => posted.push(m));
    expect(posted).toEqual([response]);
  });
});
