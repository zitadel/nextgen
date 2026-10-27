import { type DependencyList, useEffect, useState } from "react";

/**
 * A read's answer for a component: `undefined` until the first answer,
 * `fallback` if it fails, and never an answer that arrives after `deps` moved
 * on. A re-read keeps showing the previous answer until the new one lands, so
 * a refresh does not flash a loading state; key the component instead where
 * the old answer would be wrong (another project's teams). `null` for `load`
 * skips the read and answers `fallback`.
 *
 * For the chrome reads that must not block a screen or raise a boundary — the
 * switchers and search — where a failure degrades to an
 * empty or absent value instead.
 */
export function useAsync<T, F>(
  load: (() => Promise<T>) | null,
  fallback: F,
  deps: DependencyList,
): T | F | undefined {
  const [value, setValue] = useState<T | F | undefined>(undefined);
  // The caller's `deps` decide when to read again; `load` is a fresh closure every render.
  useEffect(() => {
    if (!load) {
      setValue(fallback);
      return;
    }
    let cancelled = false;
    load()
      .then((next) => {
        if (!cancelled) setValue(next);
      })
      .catch(() => {
        if (!cancelled) setValue(fallback);
      });
    return () => {
      cancelled = true;
    };
  }, deps);
  return value;
}
