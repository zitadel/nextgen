import { useEffect, useRef, useState } from "react";

import { describeError } from "@/lib/api-error";

/**
 * A list as the latest search term has it, without a new load.
 *
 * A list screen's loader leaves the term (`?q=`) out of its deps: past the
 * router's pending delay a new match swaps the screen for the pending state,
 * and the field being typed in goes with it. So a term that comes after the
 * load is read here, once, with `read`, and the screen stays mounted
 * meanwhile. `fromRoute` is what the loader returned, carrying the term it
 * answered as `q`.
 *
 * Only the latest term's answer is kept, whichever comes back last, and only
 * for as long as that load stands. `searching` while the rows of the last
 * search stand in for the next one's. A failed search is said beside the list
 * it could not replace (`searchError`), as a failed Load more is: thrown, it
 * would take the screen and the field with it.
 */
export function useSearchedLoad<T extends { q?: string }>(
  q: string | undefined,
  fromRoute: T,
  read: (base: T) => Promise<T>,
  failed: string,
): { loaded: T; searching: boolean; searchError: string | undefined } {
  const [found, setFound] = useState<{ base: T; page: T }>();
  const [searchError, setSearchError] = useState<string>();
  // The newest `read`, so a term reads once however often the caller re-renders.
  const reading = useRef(read);
  reading.current = read;
  useEffect(() => {
    setSearchError(undefined);
    if (q === fromRoute.q) {
      setFound(undefined);
      return;
    }
    let latest = true;
    reading.current(fromRoute).then(
      (page) => {
        if (latest) setFound({ base: fromRoute, page });
      },
      (cause) => {
        if (latest) setSearchError(describeError(cause, failed));
      },
    );
    return () => {
      latest = false;
    };
  }, [q, fromRoute, failed]);
  const loaded = found?.base === fromRoute ? found.page : fromRoute;
  const searching = loaded.q !== q && !searchError;
  return { loaded, searching, searchError };
}
