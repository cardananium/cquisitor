// Turn a library return value into the value the caller sees. Same rule for both transports.

import { convertSerdeNumbers, parseSerdeJson } from "@/utils/serdeNumbers";
import { answersInJsonText, type LibFunction } from "./protocol";

/** Parse JSON text and convert serde numbers. Uses an explicit stack, so depth does not cost a call frame per level. */
export function readJsonAnswer(text: string): unknown {
  return parseSerdeJson(text);
}

/** Caller-facing value: parse JSON text for document walkers, convert serde numbers otherwise. */
export function readAnswer(fn: LibFunction, raw: unknown): unknown {
  if (answersInJsonText(fn)) {
    if (typeof raw !== "string") {
      throw new Error(`The library answered ${fn} with something other than JSON text`);
    }
    return readJsonAnswer(raw);
  }
  return convertSerdeNumbers(raw);
}
