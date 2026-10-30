import { nextToken, RepeatedCursorError } from "@zitadel/api/runtime/paging";

import { ZitadelError } from "../../errors";

/**
 * The first page of `source`, or with `all` every page in order, as one list
 * of the items `items` takes from each page. `next` is the cursor to the page
 * after the first, or `null` once `all` has read the last page. `onePage`
 * names the caller's own way to read one page, for when the server loops.
 */
export const collectPages = async <P, T>(
  source: AsyncIterable<P>,
  {
    items,
    all,
    next = nextToken,
    onePage = "--limit and --page-token",
  }: Readonly<{
    items: (page: P) => readonly T[];
    all: boolean;
    next?: (page: P) => string | undefined;
    onePage?: string;
  }>,
): Promise<{ items: T[]; next: string | null }> => {
  // Accumulated in one array rather than by concatenating each page onto the
  // last: these resources are unbounded, and a wide `--all` would otherwise
  // copy every record once per remaining page.
  const collected: T[] = [];
  let fetched = 0;
  try {
    for await (const page of source) {
      fetched += 1;
      try {
        collected.push(...items(page));
      } catch (error) {
        throw new ZitadelError("E_VALIDATION", (error as Error).message, {
          details: { response: page },
        });
      }
      if (!all) {
        return { items: collected, next: next(page) ?? null };
      }
    }
  } catch (error) {
    if (error instanceof RepeatedCursorError) {
      throw new ZitadelError("E_VALIDATION", error.message, {
        hint: `Fetch one page at a time with ${onePage}.`,
        details: { cursor: error.cursor, pages_fetched: fetched },
      });
    }
    throw error;
  }
  return { items: collected, next: null };
};
