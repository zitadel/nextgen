/**
 * Classifier applied to a `fetch` `Response`. Returns the value the caller
 * cares about (any non-null `T` counts as a match) or `null` to reject the
 * response. The predicate decides whether to read `.json()` / `.headers` /
 * `.status`; the prober just runs it and bubbles the verdict.
 */
export type ProbePredicate<T> = (response: Response) => Promise<T | null> | T | null;

/**
 * One non-null result from a probe sweep: the URL that responded plus the
 * value the predicate returned for it.
 */
export type ProbeMatch<T> = Readonly<{ url: string; value: T }>;
