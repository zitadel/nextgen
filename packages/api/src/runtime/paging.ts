/**
 * Cursor paging (ADR 027): a page carries `next_page_token` while more remain,
 * and the next request sends it back as `page_token`.
 *
 * The walk trusts that contract. A server that repeats a cursor, skips one or
 * answers a page in a different shape is an upstream bug to fix in the server,
 * not something the client detects or works around; do not add guards for it.
 * Typed callers read a page's list straight off it; only {@link itemsOf}, for
 * a caller that knows the list by name alone, checks it is there.
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
 * The array `field` names on a page, for a caller that learns the field only
 * at runtime (an operation picked from a table); a page without one is not a
 * page of that list.
 */
export function itemsOf(page: unknown, field: string): readonly unknown[] {
  const list = (page as Record<string, unknown> | null)?.[field];
  if (!Array.isArray(list)) {
    throw new TypeError(`Unexpected list response: missing "${field}" array`);
  }
  return list;
}

/**
 * Every page, fetched only when the loop asks for the next one, so a caller
 * that stops early never reads the rest. The first page is the one
 * `fetchPage(undefined)` answers; `next` reads a page's cursor, and an empty
 * one ends the walk like none.
 */
export async function* pages<P>(
  fetchPage: FetchPage<P>,
  { next = nextToken }: { next?: (page: P) => string | undefined } = {},
): AsyncGenerator<P, void, undefined> {
  let token: string | undefined;
  for (;;) {
    const page = await fetchPage(token);
    // Read before the page is handed out, so a loop that changes the page
    // cannot change where the walk goes.
    token = next(page) || undefined;
    yield page;
    if (token === undefined) {
      return;
    }
  }
}
