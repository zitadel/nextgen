import { useEffect, useRef, useState } from "react";

import { describeError } from "@/lib/api-error";

interface Page {
  items: unknown[];
  nextPageToken?: string;
}

/**
 * The pages a list fetches after its loader's first one.
 *
 * They live in component state so `Load more` appends without re-running the
 * loader, and a route invalidation (a create, a delete, a changed filter)
 * resets to the first page. `loaded` is the loader's result: its identity is
 * the generation of the list on screen, so a page that lands after an
 * invalidation is dropped instead of re-adding rows the server no longer
 * returns.
 *
 * A failed page keeps its token, so the button stays and retries it.
 */
export function useLoadMore<P extends Page>(
  loaded: { nextPageToken?: string },
  fetchPage: (pageToken: string) => Promise<P>,
  errorFallback: string,
  /** Runs for each page that is kept, for state the screen derives from it. */
  onPage?: (page: P) => void,
) {
  const [extra, setExtra] = useState<P["items"]>([]);
  const [nextPageToken, setNextPageToken] = useState(loaded.nextPageToken);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setExtra([]);
    setNextPageToken(loaded.nextPageToken);
    setError(undefined);
  }, [loaded]);

  const loadedRef = useRef(loaded);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  async function loadMore() {
    if (!nextPageToken || loading) return;
    const generation = loaded;
    setLoading(true);
    setError(undefined);
    try {
      const page = await fetchPage(nextPageToken);
      if (loadedRef.current !== generation) return;
      setExtra((current) => [...current, ...page.items]);
      setNextPageToken(page.nextPageToken);
      onPage?.(page);
    } catch (cause) {
      // The caller fires and forgets, and a route error boundary cannot catch
      // an event handler's rejection.
      if (loadedRef.current === generation) setError(describeError(cause, errorFallback));
    } finally {
      setLoading(false);
    }
  }

  return { extra, hasMore: Boolean(nextPageToken), loading, error, loadMore };
}

export type LoadMoreState = Pick<
  ReturnType<typeof useLoadMore>,
  "hasMore" | "loading" | "error" | "loadMore"
>;
