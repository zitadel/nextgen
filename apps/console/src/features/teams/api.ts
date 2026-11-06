import { api } from "@/api/zitadel";

/** A project's active teams, by name when `nameContains` is given: the team switcher's list and search's matches. */
export async function queryActiveTeams(
  projectId: string,
  { nameContains, limit }: { nameContains?: string; limit: number },
): Promise<{ id: string; name: string }[]> {
  const page = await api.queryTeams(
    {
      limit,
      filter: [
        { field: "status", operation: "equals", value: "active" },
        ...(nameContains
          ? [{ field: "name" as const, operation: "contains" as const, value: nameContains }]
          : []),
      ],
    },
    { project_id: projectId },
  );
  return page.teams.map(({ id, name }) => ({ id, name }));
}
