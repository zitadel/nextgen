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
