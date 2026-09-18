/**
 * Nesting depth from CBOR headers (root = 0; arrays, maps, and tags add a level; string chunks do not).
 * Stops once depth exceeds `ceiling`, or at the first unreadable header.
 */
export function cborNestingDepth(bytes: Uint8Array, ceiling: number): number {
  interface Frame {
    /** Remaining items, or `null` for an indefinite container closed by break. */
    remaining: number | null;
    /** Whether items sit one level below this container. */
    nests: boolean;
  }
  const stack: Frame[] = [];
  let depth = 0;
  let deepest = 0;
  let i = 0;
  const n = bytes.length;

  const readArgument = (additional: number, at: number): { value: number | null; width: number } | null => {
    if (additional < 24) return { value: additional, width: 0 };
    if (additional === 31) return { value: null, width: 0 };
    const width = additional === 24 ? 1 : additional === 25 ? 2 : additional === 26 ? 4 : additional === 27 ? 8 : -1;
    if (width < 0 || at + width > n) return null;
    let value = 0;
    for (let k = 0; k < width; k++) value = value * 256 + bytes[at + k];
    return { value, width };
  };

  for (;;) {
    while (stack.length > 0 && stack[stack.length - 1].remaining === 0) {
      if (stack.pop()!.nests) depth--;
    }
    if (i >= n) break;

    const initial = bytes[i];
    if (initial === 0xff) {
      i++;
      const top = stack[stack.length - 1];
      if (top && top.remaining === null) {
        if (stack.pop()!.nests) depth--;
        continue;
      }
      break;
    }

    if (depth > deepest) {
      deepest = depth;
      if (deepest > ceiling) return deepest;
    }
    const top = stack[stack.length - 1];
    if (top && top.remaining !== null) top.remaining--;

    const major = initial >> 5;
    const argument = readArgument(initial & 0x1f, i + 1);
    if (argument === null) break;
    i += 1 + argument.width;
    const { value } = argument;
    const open = (remaining: number | null, nests: boolean) => {
      stack.push({ remaining, nests });
      if (nests) depth++;
    };

    switch (major) {
      // Definite strings skip payload; indefinite strings chunk in place (do not nest).
      case 2:
      case 3:
        if (value === null) open(null, false);
        else if (i + value <= n) i += value;
        else return deepest;
        break;
      case 4:
        if (value === null) open(null, true);
        else if (value > 0) open(value, true);
        break;
      // n pairs → 2n items, all one level down.
      case 5:
        if (value === null) open(null, true);
        else if (value > 0) open(value * 2, true);
        break;
      // Tag wraps exactly one item.
      case 6:
        open(1, true);
        break;
      // Integers, simples, floats: complete in the header.
      default:
        break;
    }
  }
  return deepest;
}

/** The bytes of a hex string. The caller has checked that it is hex. */
export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Max nesting typed decoders accept; past this, get_possible_types_for_input returns no types. */
export const TYPED_DECODING_DEPTH_LIMIT = 256;

/** True if `hex` nests deeper than typed decoders will read. */
export function nestsPastTypedDecoding(hex: string): boolean {
  return cborNestingDepth(hexToBytes(hex), TYPED_DECODING_DEPTH_LIMIT) > TYPED_DECODING_DEPTH_LIMIT;
}
