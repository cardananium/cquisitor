// Latest-run wins: overlapping async work must not apply a stale result.

/**
 * Starts a run and returns a predicate true only while that run is still newest.
 * Guard every write, not only the last. `onBegin` runs first and should clear spinner-like state.
 */
export function createRunGate(onBegin?: () => void): () => () => boolean {
  let latest = 0;
  return () => {
    onBegin?.();
    const mine = ++latest;
    return () => latest === mine;
  };
}
