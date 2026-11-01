/**
 * The first page `pages` yields, or with `all` every page in order, as one
 * list of the items `items` takes from each page. `next` reads a page's
 * cursor to report it: the cursor to the page after the first, or `null` once
 * `all` has read the last page.
 *
 * Following the cursor is the walk's job, not this one's: a client function's
 * `.pages()` reads it from the page as the server sent it, before the CLI
 * escapes the page, so it goes back to the server unchanged. Without `all`
 * the walk is left after its first page, so no second one is fetched.
 */
export const collectPages = async <P, T>(
  pages: AsyncIterable<P>,
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
  for await (const page of pages) {
    collected.push(...items(page));
    if (!all) {
      return { items: collected, next: next(page) || null };
    }
  }
  return { items: collected, next: null };
};
