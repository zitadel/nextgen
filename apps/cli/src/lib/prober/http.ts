import type { ProbeMatch, ProbePredicate } from "./types";

/**
 * Fetch `url` with a per-call timeout and pass the resulting `Response` to
 * `predicate`. Returns the predicate's value, or `null` on any failure: a
 * network error, an `AbortError` from the timeout, a thrown predicate, or the
 * predicate returning `null`.
 *
 * Never throws. The predicate decides what counts as a match — it gets the
 * raw `Response` and may read `.json()` / `.headers` / `.status` as needed.
 *
 * `timeoutMs` defaults to 500ms. The implementation uses
 * `AbortSignal.timeout`, so the underlying fetch is cancelled when the
 * timeout fires (no orphaned sockets).
 */
export async function probeUrl<T>(
  url: string,
  predicate: ProbePredicate<T>,
  opts?: { readonly timeoutMs?: number },
): Promise<T | null> {
  const timeoutMs = opts?.timeoutMs ?? 500;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return await predicate(response);
  } catch {
    return null;
  }
}

/**
 * Probe many URLs in parallel and return the non-null matches, preserving
 * the input order. Each URL is bounded by `timeoutMs` independently — one
 * slow target can't hold up the others.
 */
export async function probeUrls<T>(
  urls: Iterable<string>,
  predicate: ProbePredicate<T>,
  opts?: { readonly timeoutMs?: number },
): Promise<ReadonlyArray<ProbeMatch<T>>> {
  const list = [...urls];
  const results = await Promise.all(
    list.map(async (url): Promise<ProbeMatch<T> | null> => {
      const value = await probeUrl(url, predicate, opts);
      return value === null ? null : { url, value };
    }),
  );
  return results.filter((match): match is ProbeMatch<T> => match !== null);
}
