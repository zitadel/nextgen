import { api } from "@/api/zitadel";

import type { SearchAnswer, SearchResultType } from "./model";

/**
 * Up to `limit` of each of `types` in a project that match `query`, best
 * match first, from `POST /search` (root ADR 087). The server matches and
 * ranks; a caller only names what it wants to hear about.
 */
export async function search(
  projectId: string,
  query: string,
  types: readonly SearchResultType[],
  limit: number,
): Promise<SearchAnswer> {
  const found = await api.search(
    { query, types: [...types], limit_per_type: limit },
    { project_id: projectId },
  );
  return {
    term: query,
    hits: found.results.map(({ type, id, title, subtitle }) => ({ type, id, title, subtitle })),
    incomplete: found.incomplete_types,
  };
}
