import { api } from "@/api/zitadel";

import type { SearchAnswer, SearchResultType } from "./model";

/**
 * Up to `limit` of each of `types` that match `query`, best match first, from
 * `POST /search` (root ADR 087): in `projectId`, or with none in the projects
 * the person can act on, the first ten of them (`moreProjects` says there are
 * more). Each hit says which project it is in. The server matches and ranks; a
 * caller only names what it wants to hear about.
 */
export async function search(
  projectId: string | undefined,
  query: string,
  types: readonly SearchResultType[],
  limit: number,
): Promise<SearchAnswer> {
  const found = await api.search(
    { query, types: [...types], limit_per_type: limit },
    projectId ? { project_id: projectId } : undefined,
  );
  return {
    term: query,
    hits: found.results.map(({ type, id, project_id, title, subtitle }) => ({
      type,
      id,
      projectId: project_id,
      title,
      subtitle,
    })),
    incomplete: found.incomplete_types,
    moreProjects: found.more_projects,
  };
}
