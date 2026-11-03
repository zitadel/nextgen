/**
 * Fetches the page a cursor names.
 *
 * @param token - The cursor of the page to fetch, or `undefined` for the first page.
 * @param number - How many pages have been asked for, counting this one, from 1.
 */
export type FetchPage<P> = (token: string | undefined, number: number) => Promise<P>;

/**
 * How to read one page of a list.
 */
export type PageReaders<P, T> = {
  /** The items on `page`. */
  readonly items: (page: P) => readonly T[];
  /** The cursor to the page after `page`; none, `null` or an empty string when it is the last. */
  readonly next: (page: P) => string | null | undefined;
};

/**
 * What {@link Paging.collect} gathers from a walk.
 */
export type Collected<P, T> = {
  /** The items of every page it read, in order. */
  readonly items: readonly T[];
  /** The cursor to the page after the last one it read, or `null` when none remains. */
  readonly next: string | null;
  /** The last page it read, or `undefined` when the walk yielded none. */
  readonly last: P | undefined;
};

/**
 * A cursor-paged list (ADR 027): a page carries a cursor while more remain,
 * and the request for the next page sends it back.
 *
 * A `Paging` knows how to read a page of one list, and from that how to walk
 * the pages and how to gather them. Build one from readers when the page is
 * typed, or from field names with {@link Paging.byField} when the list is only
 * known at run time.
 *
 * The walk trusts the contract. A server that repeats a cursor, skips one or
 * answers a page in a different shape is an upstream bug to fix in the server,
 * not something the client detects or works around; do not add guards for it.
 *
 * @example
 * const users = new Paging({
 *   items: (page: UsersPage) => page.users,
 *   next: (page) => page.next_page_token,
 * });
 * const { items } = await users.collect(users.walk(fetchUsers), { all: true });
 */
export class Paging<P, T = unknown> {
  private readonly readers: PageReaders<P, T>;

  /**
   * @param readers - How to read a page's items and its cursor.
   */
  constructor(readers: PageReaders<P, T>) {
    this.readers = readers;
  }

  /**
   * A paging for a list whose fields are known only by name, such as an
   * operation picked from a table at run time. A page without the items
   * field is not a page of that list.
   *
   * @param items - The name of the field holding a page's items.
   * @param cursor - The name of the field holding the next cursor.
   * @throws TypeError from {@link Paging.items} when the page has no such list.
   * @example
   * Paging.byField("users").items({ users: ["a", "b"] }); // ["a", "b"]
   * Paging.byField("users").next({ next_page_token: "t1" }); // "t1"
   */
  static byField(items: string, cursor = "next_page_token"): Paging<unknown> {
    return new Paging<unknown>({
      items: (page) => {
        return Paging.listIn(page, items);
      },
      next: (page) => {
        return Paging.cursorIn(page, cursor);
      },
    });
  }

  /**
   * The items on `page`.
   *
   * @param page - A page of this list.
   */
  items(page: P): readonly T[] {
    return this.readers.items(page);
  }

  /**
   * The cursor to the page after `page`.
   *
   * @param page - A page of this list.
   * @returns The cursor, or `undefined` when `page` is the last: no cursor,
   * `null` and an empty string all mean the same.
   */
  next(page: P): string | undefined {
    return this.readers.next(page) || undefined;
  }

  /**
   * Every page, fetched only when the loop asks for the next one, so a caller
   * that stops early never reads the rest. The first page is the one
   * `fetchPage(undefined, 1)` answers.
   *
   * A page's cursor is read before the page is handed out, so a loop that
   * changes the page cannot change where the walk goes.
   *
   * @param fetchPage - Fetches the page a cursor names, and is told which page
   * of the walk it is.
   */
  async *walk(fetchPage: FetchPage<P>): AsyncGenerator<P, void, undefined> {
    let token: string | undefined;
    for (let number = 1; ; number += 1) {
      const page = await fetchPage(token, number);
      token = this.next(page);
      yield page;
      if (token === undefined) {
        return;
      }
    }
  }

  /**
   * The first page of `pages`, or with `all` every page in order, as one list
   * of their items, with the cursor to the page after the last one read and
   * that last page itself.
   *
   * Without `all` the walk is left after its first page, so no second one is
   * fetched. When the walk ends on a page that still names a next page, that
   * cursor is reported rather than dropped, so a caller can resume from it.
   *
   * The items are gathered into one array rather than concatenated page by
   * page: these lists are unbounded, and a wide drain would otherwise copy
   * every record once per remaining page.
   *
   * @param pages - A walk of this list's pages, from {@link Paging.walk} or a
   * client function's `.pages()`.
   * @param options - `all` reads every page; otherwise only the first.
   */
  async collect(
    pages: AsyncIterable<P>,
    { all }: { readonly all: boolean },
  ): Promise<Collected<P, T>> {
    const items: T[] = [];
    let last: P | undefined;
    for await (const page of pages) {
      for (const item of this.items(page)) {
        items.push(item);
      }
      last = page;
      if (!all) {
        return { items, next: this.next(page) ?? null, last };
      }
    }
    return { items, next: last === undefined ? null : (this.next(last) ?? null), last };
  }

  private static cursorIn(page: unknown, field: string): string | undefined {
    const cursor = (page as Record<string, unknown> | null)?.[field];
    if (typeof cursor === "string" && cursor !== "") {
      return cursor;
    }
    return undefined;
  }

  private static listIn(page: unknown, field: string): readonly unknown[] {
    const list = (page as Record<string, unknown> | null)?.[field];
    if (!Array.isArray(list)) {
      throw new TypeError(`Unexpected list response: missing "${field}" array`);
    }
    return list;
  }
}
