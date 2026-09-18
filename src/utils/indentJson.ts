/** Max nesting to re-indent. Deeper documents are returned unchanged; indent cost is quadratic in depth. */
export const MAX_INDENTED_DEPTH = 256;

/**
 * Re-indent JSON text (2 spaces), or return it unchanged if invalid or deeper than MAX_INDENTED_DEPTH.
 * Walks tokens so integers past 2^53 keep their digits and deep nesting cannot RangeError.
 */
export function indentJsonText(text: string, indent = "  "): string {
  let out = "";
  let depth = 0;
  // True after `{`/`[` until the first item is written (empty containers stay `{}`/`[]`).
  let opened = false;
  const n = text.length;
  let i = 0;
  const line = () => "\n" + indent.repeat(depth);
  while (i < n) {
    const c = text[i];
    if (c === " " || c === "\n" || c === "\r" || c === "\t") {
      i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (j >= n) return text;
      if (opened) {
        out += line();
        opened = false;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "{" || c === "[") {
      if (depth === MAX_INDENTED_DEPTH) return text;
      if (opened) out += line();
      out += c;
      depth++;
      opened = true;
      i++;
      continue;
    }
    if (c === "}" || c === "]") {
      if (depth === 0) return text;
      depth--;
      if (opened) opened = false;
      else out += line();
      out += c;
      i++;
      continue;
    }
    if (c === ",") {
      out += "," + line();
      i++;
      continue;
    }
    if (c === ":") {
      out += ": ";
      i++;
      continue;
    }
    // Number, true, false, or null: copy through to the next delimiter.
    let j = i;
    while (j < n && !',:{}[]" \n\r\t'.includes(text[j])) j++;
    if (opened) {
      out += line();
      opened = false;
    }
    out += text.slice(i, j);
    i = j;
  }
  return depth === 0 ? out : text;
}
