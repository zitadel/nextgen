/**
 * Cursor paging (ADR 027): a page carries `next_page_token` while more remain,
 * and the next request sends it back as `page_token`.
 */

/** Fetches the page a cursor names; `undefined` asks for the first page. */
export type FetchPage<P> = (token: string | undefined) => Promise<P>;

/**
 * The cursor to the page after `page`, or `undefined` on the last one. `field`
 * names it, for an API that calls it other than `next_page_token`.
 */
export function nextToken(page: unknown, field = "next_page_token"): string | undefined {
  const token = (page as Record<string, unknown> | null)?.[field];
  return typeof token === "string" && token !== "" ? token : undefined;
}

/**
 * Every page, fetched only when the loop asks for the next one, so a caller
 * that stops early never reads the rest. The walk begins at the cursor `start`
 * names, or at the first page without one; `next` reads a page's cursor.
 */
export async function* pages<P>(
  fetchPage: FetchPage<P>,
  { start, next = nextToken }: { start?: string; next?: (page: P) => string | undefined } = {},
): AsyncGenerator<P, void, undefined> {
  // A server that answers a cursor it already issued would be walked forever.
  const seen = new Set(start === undefined ? [] : [start]);
  let token = start;
  do {
    const page = await fetchPage(token);
    yield page;
    token = next(page);
    if (token !== undefined) {
      if (seen.has(token)) {
        throw new Error(
          "The server repeated a page cursor, so the list would never end. " +
            "Read it one page at a time instead, and report the repeated cursor.",
        );
      }
      seen.add(token);
    }
  } while (token !== undefined);
}
