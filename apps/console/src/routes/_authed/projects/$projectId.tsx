import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * One project's page, by id: selects that project and opens its settings.
 *
 * The page itself lives at `/project`, scoped like every other screen about a
 * project (`src/lib/project-scope.ts`). This path stays so a link that names a
 * project — a bookmark, another tool, a test — still lands on it, with the
 * sidebar and switcher following the project it names.
 */
export const Route = createFileRoute("/_authed/projects/$projectId")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/project", search: { project: params.projectId }, replace: true });
  },
});
