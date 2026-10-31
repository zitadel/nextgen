/**
 * The first page of `source`, or with `all` every page in order, as one list
 * of the items `items` takes from each page. `next` is the cursor to the page
 * after the first, or `null` once `all` has read the last page.
 */
export const collectPages = async <P, T>(
  source: AsyncIterable<P>,
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
  for await (const page of source) {
    collected.push(...items(page));
    if (!all) {
      return { items: collected, next: next(page) || null };
    }
  }
  return { items: collected, next: null };
};
