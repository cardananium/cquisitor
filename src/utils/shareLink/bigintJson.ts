const BIGINT_TAG = "$bi";

export function stringifyWithBigInt(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "bigint") {
      return { [BIGINT_TAG]: val.toString() };
    }
    return val;
  });
}

export function parseWithBigInt(text: string): unknown {
  return JSON.parse(text, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const keys = Object.keys(val as Record<string, unknown>);
      if (keys.length === 1 && keys[0] === BIGINT_TAG) {
        const s = (val as Record<string, unknown>)[BIGINT_TAG];
        if (typeof s === "string") {
          try {
            return BigInt(s);
          } catch {
            return val;
          }
        }
      }
    }
    return val;
  });
}
