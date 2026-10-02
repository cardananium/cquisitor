// JSON text of a value for a label or tooltip: iterative, so a value nested
// thousands of levels deep cannot overflow the host stack the way
// `JSON.stringify` does, and cut at `max` characters so a huge subtree costs
// no more than the text shown. Bigints print as their digits.

type Task = { value: unknown } | { text: string };

/** Up to `max` characters of the JSON text of `value`, with "…" when cut. */
export function boundedJson(value: unknown, max = 200): string {
  let out = "";
  const stack: Task[] = [{ value }];
  const emit = (text: string): boolean => {
    out += text;
    return out.length <= max;
  };
  while (stack.length > 0) {
    const task = stack.pop()!;
    if ("text" in task) {
      if (!emit(task.text)) break;
      continue;
    }
    const v = task.value;
    let text: string | null = null;
    if (v === null || v === undefined) text = "null";
    else if (typeof v === "bigint") text = v.toString();
    else if (typeof v === "number") text = Number.isFinite(v) ? String(v) : "null";
    else if (typeof v === "boolean") text = String(v);
    else if (typeof v === "string") text = JSON.stringify(v);
    else if (typeof v === "function" || typeof v === "symbol") text = "null";
    if (text !== null) {
      if (!emit(text)) break;
      continue;
    }
    if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      const items = Array.isArray(v) ? v : Array.from(v as unknown as ArrayLike<number>);
      if (!emit("[")) break;
      stack.push({ text: "]" });
      for (let i = items.length - 1; i >= 0; i--) {
        stack.push({ value: items[i] });
        if (i > 0) stack.push({ text: "," });
      }
      continue;
    }
    const entries = Object.entries(v as Record<string, unknown>).filter(
      ([, item]) => item !== undefined && typeof item !== "function" && typeof item !== "symbol",
    );
    if (!emit("{")) break;
    stack.push({ text: "}" });
    for (let i = entries.length - 1; i >= 0; i--) {
      stack.push({ value: entries[i][1] });
      stack.push({ text: `${JSON.stringify(entries[i][0])}:` });
      if (i > 0) stack.push({ text: "," });
    }
  }
  return out.length > max ? out.slice(0, max - 1) + "…" : out;
}
