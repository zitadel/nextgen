/**
 * One page of a resource list. `Load more` walks the rest, so this is a page
 * size rather than a cap on what the operator can reach (design decisions log
 * D5: a button, not pagination controls).
 */
export const LIST_PAGE_SIZE = 25;

/**
 * Follow a cursor to the end. The screens that need a whole collection,
 * resolving slugs or computing "Used by", have no API that answers them
 * directly, so they read it all; projects carry a handful of each.
 */
export async function readAllPages<T>(
  fetchPage: (pageToken?: string) => Promise<{ items: T[]; next?: string | null }>,
): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;
  do {
    const page = await fetchPage(pageToken);
    items.push(...page.items);
    pageToken = page.next ?? undefined;
  } while (pageToken);
  return items;
}
