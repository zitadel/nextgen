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

/** The array `field` names on a page; a page without one is not a page of that list. */
export function itemsOf(page: unknown, field: string): readonly unknown[] {
  const list = (page as Record<string, unknown> | null)?.[field];
  if (!Array.isArray(list)) {
    throw new TypeError(`Unexpected list response: missing "${field}" array`);
  }
  return list;
}

/** A server answered a cursor it had already issued, so the walk would never end. */
export class RepeatedCursorError extends Error {
  readonly cursor: string;

  constructor(cursor: string) {
    super(
      "The server returned the same page cursor twice, so the list would never end. " +
        "Read it one page at a time instead.",
    );
    this.name = "RepeatedCursorError";
    this.cursor = cursor;
  }
}

/**
 * Every page, fetched only when the loop asks for the next one, so a caller
 * that stops early never reads the rest. The walk begins at the cursor `start`
 * names, or at the first page without one; `next` reads a page's cursor, and
 * an empty one ends the walk like none.
 */
export async function* pages<P>(
  fetchPage: FetchPage<P>,
  { start, next = nextToken }: { start?: string; next?: (page: P) => string | undefined } = {},
): AsyncGenerator<P, void, undefined> {
  // A server that answers a cursor it already issued would be walked forever.
  const seen = new Set(start === undefined ? [] : [start]);
  let token = start;
  for (;;) {
    const page = await fetchPage(token);
    // Read before the page is handed out, so a loop that changes the page
    // cannot change where the walk goes.
    token = next(page) || undefined;
    yield page;
    if (token === undefined) {
      return;
    }
    if (seen.has(token)) {
      throw new RepeatedCursorError(token);
    }
    seen.add(token);
  }
}
