import { type DependencyList, useEffect, useState } from "react";

import type { SessionCached } from "@/lib/session-cache";

/**
 * A read's answer for a component: `undefined` while it loads, `fallback` if
 * it fails, and never an answer that arrives after `deps` moved on. `null` for
 * `load` skips the read and answers `fallback`.
 *
 * For the chrome reads that must not block a screen or raise a boundary — the
 * switchers, the account footer, search — where a failure degrades to an
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
    setValue(undefined);
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

/** {@link useAsync} over a {@link SessionCached} read, re-read whenever it is cleared. */
export function useSessionCached<T, F>(
  read: SessionCached<T>,
  fallback: F,
  enabled = true,
): T | F | undefined {
  const [version, setVersion] = useState(0);
  useEffect(() => read.subscribe(() => setVersion((current) => current + 1)), [read]);
  return useAsync(enabled ? read : null, fallback, [read, enabled, version]);
}
