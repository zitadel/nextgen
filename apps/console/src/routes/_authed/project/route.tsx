import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Boxes } from "lucide-react";

import { api } from "@/api/zitadel";
import { DETAIL_BODY, DetailHeader } from "@/components/detail-page";
import { Page } from "@/components/layout";
import { formatDate } from "@/lib/date";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";

/**
 * The selected project's Settings: a list of its own in the sidebar, as the
 * root Settings above every project is (D29) and as Vercel's project Settings
 * is (D40). The project's row opens it, and its pages are the routes beneath
 * this one: General (name, origins, variables, policies) and Admins (who has
 * access and how, #1238, #1462). For the reserved platform project they are
 * the root's (D42): its pages head the root's Settings list, before what the
 * hosted cloud adds.
 *
 * This layout reads the project and draws its header on every page, so moving
 * between them keeps the header and reads only the page's own data. It is
 * scoped like the rest: the pages follow the selection, and Projects is where
 * projects are compared and picked. `/projects/$projectId` redirects here with
 * that project selected, so a link to one project's page still lands on it,
 * and the projects list's row menu opens it as `View project`.
 *
 * The header's identity line carries `Project ID` and `Created`. The design
 * draws a third value, `Issuer` (the project's issuer origin), but nothing
 * carries it:
 * `project-response` is `id`, `name`, `origins`, `created_at` and
 * `updated_at`, and `issuer` appears nowhere in the spec, the console or the
 * domain layer. The value is left out rather than shown empty, and returns as one
 * more `meta` item when the field lands.
 */
export const Route = createFileRoute("/_authed/project")({
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }) => ({
    project: await api.getProject(requireProjectScope(deps.project)),
  }),
  component: ProjectSettingsLayout,
});

function ProjectSettingsLayout() {
  const { project } = Route.useLoaderData();

  return (
    <Page>
      <DetailHeader
        icon={Boxes}
        title={project.name}
        meta={[
          { label: "Project ID", value: project.id, copyable: true },
          { label: "Created", value: formatDate(project.created_at) },
        ]}
      />
      <div className={DETAIL_BODY}>
        <Outlet />
      </div>
    </Page>
  );
}
