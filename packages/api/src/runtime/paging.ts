/**
 * Cursor paging (ADR 027): a page carries `next_page_token` while more remain,
 * and the next request sends it back as `page_token`.
 */

/** Fetches the page a cursor names; `undefined` asks for the first. */
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
 * that stops early never reads the rest. `start` is the cursor the first page
 * was asked for, if any; `next` reads a page's cursor.
 */
export async function* pages<P>(
  fetchPage: FetchPage<P>,
  { start, next = nextToken }: { start?: string; next?: (page: P) => string | undefined } = {},
): AsyncGenerator<P, void, undefined> {
  // A server that answers a cursor it already issued would be walked forever.
  const seen = new Set(start === undefined ? [] : [start]);
  let token: string | undefined;
  do {
    const page = await fetchPage(token);
    yield page;
    token = next(page);
    if (token !== undefined) {
      if (seen.has(token)) {
        throw new Error("The server repeated a page cursor, so the list would never end");
      }
      seen.add(token);
    }
  } while (token !== undefined);
}

/** How a generated function pages: the field holding its items, and the argument carrying `page_token`. */
export type PagingShape = Readonly<{ items: string; arg: number }>;

/**
 * `pages`, `items` and `all` for one generated function. Each takes the
 * function's own arguments; the first page is fetched with them as given, so a
 * `page_token` among them is where it starts.
 */
export function paged(call: (...args: unknown[]) => unknown, shape: PagingShape) {
  const pagesOf = (args: unknown[]) =>
    pages(
      async (token) => call(...(token === undefined ? args : withToken(args, shape.arg, token))),
      { start: (args[shape.arg] as { page_token?: string } | undefined)?.page_token },
    );

  return {
    pages: (...args: unknown[]) => pagesOf(args),
    items: async function* (...args: unknown[]) {
      for await (const page of pagesOf(args)) {
        yield* itemsOf(page, shape.items);
      }
    },
    all: async (...args: unknown[]) => {
      const collected: unknown[] = [];
      for await (const page of pagesOf(args)) {
        collected.push(...itemsOf(page, shape.items));
      }
      return collected;
    },
  };
}

/** `args` with `page_token` set on the argument at `index`, leaving the caller's untouched. */
function withToken(args: readonly unknown[], index: number, token: string): unknown[] {
  // Built fresh rather than with `Array.prototype.with`, which throws when the
  // caller left an optional argument at `index` off.
  return Array.from({ length: Math.max(args.length, index + 1) }, (_, i) =>
    i === index ? { ...(args[i] as object | undefined), page_token: token } : args[i],
  );
}

/** The array `field` names on a page; a page without one is not a page of this list. */
export function itemsOf(page: unknown, field: string): readonly unknown[] {
  const list = (page as Record<string, unknown> | null)?.[field];
  if (!Array.isArray(list)) {
    throw new TypeError(`Expected the response to carry a "${field}" array`);
  }
  return list;
}
