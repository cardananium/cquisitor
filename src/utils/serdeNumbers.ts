/** serde_json box for integers that would not be exact as a JS number. */
const SERDE_NUMBER_KEY = "$serde_json::private::Number";

/** Unbox a serde number: float stays number; integer is number if safe, otherwise bigint. */
function unboxSerdeNumber(numStr: string): number | bigint {
  // Floats (contain '.' or exponent) can't go through BigInt
  if (/[.eE]/.test(numStr)) return Number(numStr);
  const num = Number(numStr);
  if (Number.isSafeInteger(num)) return num;
  return BigInt(numStr);
}

function isSerdeNumberBox(record: Record<string, unknown>): boolean {
  return SERDE_NUMBER_KEY in record;
}

interface ConvertFrame {
  source: Record<string, unknown> | unknown[];
  target: Record<string, unknown> | unknown[];
  keys: string[] | null;
  next: number;
}

/** Assign `key` as an own property; `__proto__` must not go through the prototype setter. */
function setOwn(target: Record<string | number, unknown>, key: string | number, value: unknown): void {
  if (key === "__proto__") {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
  } else {
    target[key] = value;
  }
}

/**
 * Convert serde_json number boxes to number/bigint throughout a copy of `obj`.
 * Iterative so deep CBOR does not overflow the call stack.
 */
export function convertSerdeNumbers<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  const record = obj as Record<string, unknown>;
  if (!Array.isArray(obj) && isSerdeNumberBox(record)) {
    return unboxSerdeNumber(record[SERDE_NUMBER_KEY] as string) as T;
  }

  const root: Record<string, unknown> | unknown[] = Array.isArray(obj) ? [] : {};
  const stack: ConvertFrame[] = [
    {
      source: obj as Record<string, unknown> | unknown[],
      target: root,
      keys: Array.isArray(obj) ? null : Object.keys(record),
      next: 0,
    },
  ];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const { source, target, keys } = frame;
    const length = keys ? keys.length : (source as unknown[]).length;
    if (frame.next >= length) {
      stack.pop();
      continue;
    }
    const index = frame.next++;
    const key: string | number = keys ? keys[index] : index;
    const value = (source as Record<string | number, unknown>)[key];

    const into = target as Record<string | number, unknown>;
    if (value === null || value === undefined || typeof value !== "object") {
      setOwn(into, key, value);
      continue;
    }
    if (Array.isArray(value)) {
      const child: unknown[] = [];
      setOwn(into, key, child);
      stack.push({ source: value, target: child, keys: null, next: 0 });
      continue;
    }
    const valueRecord = value as Record<string, unknown>;
    if (isSerdeNumberBox(valueRecord)) {
      setOwn(into, key, unboxSerdeNumber(valueRecord[SERDE_NUMBER_KEY] as string));
      continue;
    }
    const child: Record<string, unknown> = {};
    setOwn(into, key, child);
    stack.push({ source: valueRecord, target: child, keys: Object.keys(valueRecord), next: 0 });
  }

  return root as T;
}

/** Parse JSON text and convert serde number boxes without recursing on document depth. */
export function parseSerdeJson<T = unknown>(text: string): T {
  return convertSerdeNumbers(JSON.parse(text)) as T;
}
