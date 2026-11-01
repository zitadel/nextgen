import { type FetchPage, pages } from "@zitadel/api/runtime/paging";

import { sanitizeResponse } from "../../api-client";

/**
 * The first page `fetchPage` answers, or with `all` every page in order, as
 * one list of the items `items` takes from each page. `next` reads a page's
 * cursor, both to follow it and to report it: the cursor to the page after
 * the first, or `null` once `all` has read the last page.
 *
 * `fetchPage` answers each page as the server sent it, so the cursor goes back
 * to the server exactly as it came. What the walk answers, the items and the
 * cursor it reports, is escaped for the terminal here, once.
 */
export const collectPages = async <P, T>(
  fetchPage: FetchPage<P>,
  {
    items,
    all,
    next,
  }: Readonly<{
    items: (page: P) => readonly T[];
    all: boolean;
    next: (page: P) => string | null | undefined;
  }>,
): Promise<{ items: T[]; next: string | null }> => {
  // Accumulated in one array rather than by concatenating each page onto the
  // last: these resources are unbounded, and a wide `--all` would otherwise
  // copy every record once per remaining page.
  const collected: T[] = [];
  for await (const page of pages(fetchPage, { next: (page) => next(page) || undefined })) {
    collected.push(...sanitizeResponse(items(page)));
    if (!all) {
      return { items: collected, next: sanitizeResponse(next(page) || null) };
    }
  }
  return { items: collected, next: null };
};
