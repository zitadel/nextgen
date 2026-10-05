import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Box, SlidersHorizontal } from "lucide-react";

import { api } from "@/api/zitadel";
import { MetaRule, MetaValue } from "@/components/detail-meta";
import { DETAIL_BODY, DetailHeader, DetailPage } from "@/components/detail-page";
import { ProjectAdmins } from "@/components/project-admins";
import { RenameCard } from "@/components/rename-card";
import { formatDate } from "@/lib/date";
import { projectScopeDeps, requireProjectScope } from "@/lib/project-scope";

/**
 * Project settings — the selected project's own page.
 *
 * It is the one sidebar entry about the project rather than something in it,
 * and it is scoped like the rest: the page follows the selection, and the
 * Projects overview (the sidebar's first entry) is where projects are
 * compared and picked. `/projects/$projectId` redirects here with that project
 * selected, so a link to one project's page still lands on it.
 *
 * The header card carries `PROJECT ID` and `CREATED`. The design draws a third
 * cell, `ISSUER` — the project's issuer origin — but nothing carries it:
 * `project-response` is `id`, `name`, `preview_origins`, `created_at` and
 * `updated_at`, and `issuer` appears nowhere in the spec, the console or the
 * domain layer. The cell is left out rather than shown empty, and returns as one
 * more `MetaValue` when the field lands.
 *
 * Below the details, the project's admins (#1238): grants are project-level
 * data, so they live on the project's page rather than under account settings,
 * and the id every grant request carries is this route's. Loaded together with
 * the project: both reads are the same viewer check on the same project, so
 * they succeed or fail as one.
 */
export const Route = createFileRoute("/_authed/project/")({
  // Last: the list above it is the project's contents, this is the project.
  staticData: {
    scope: "project",
    nav: { label: "Project settings", order: 5, icon: SlidersHorizontal },
  },
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }) => {
    const projectId = requireProjectScope(deps.project);
    const [project, grants] = await Promise.all([
      api.getProject(projectId),
      // One page: a project's admins are a handful. Add paging with the first
      // project that needs it.
      api.queryGrants({ limit: 100, expand: ["principal"] }, { project_id: projectId }),
    ]);
    return { project, grants: grants.grants };
  },
  component: ProjectDetail,
});

function ProjectDetail() {
  const { project, grants } = Route.useLoaderData();
  const router = useRouter();

  return (
    <DetailPage>
      <DetailHeader
        icon={Box}
        title={project.name}
        meta={
          <>
            <MetaValue label="Project ID" value={project.id} copyable />
            <MetaRule />
            <MetaValue label="Created" value={formatDate(project.created_at)} />
          </>
        }
      />

      <RenameCard
        id="project-name"
        label="Project name"
        value={project.name}
        onSave={async (name) => {
          await api.patchProject(project.id, { name });
          await router.invalidate();
        }}
        errorFallback="Could not save the project."
        className={DETAIL_BODY}
      />

      <ProjectAdmins
        projectId={project.id}
        grants={grants}
        onChanged={() => void router.invalidate()}
      />
    </DetailPage>
  );
}
