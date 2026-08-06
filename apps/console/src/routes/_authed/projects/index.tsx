import { createFileRoute } from "@tanstack/react-router";
import { Alert } from "@zitadel/ui-react";

import { api } from "../../../api/zitadel";
import { getConsoleProjectId } from "../../../runtime/runtime";
import { Page } from "../../../components/layout";
import { KeyValueTable, PageHeader } from "../../../components/resource-page";

/**
 * The scoped project, read from `GET /projects/{project_id}`.
 *
 * **Reachable by URL, deliberately not in the sidebar.** The data is real, but
 * this screen has had no design hand-off — Users is the only designed surface —
 * and the layout here is a developer's key/value table, not a designed one. In
 * the nav it read as a finished feature; at a URL it is what it is, a way to see
 * the project the console is bound to.
 *
 * Restore `staticData: { nav: { label: "Projects", order: 1, icon: Boxes } }`
 * when a design for it lands.
 */
export const Route = createFileRoute("/_authed/projects/")({
  loader: () => api.getProject(getConsoleProjectId()),
  component: ProjectView,
});

function ProjectView() {
  const project = Route.useLoaderData();

  return (
    <Page>
      <PageHeader title="Projects" description="The project this console is scoped to." />
      <Alert severity="info" heading="Single project view">
        The API exposes the current project only — there is no multi-project list endpoint yet, so
        this page shows the scoped project rather than a browsable list.
      </Alert>
      <div className="mt-6">
        <KeyValueTable
          rows={[
            ["ID", project.id],
            ["Created", project.created_at],
            ["Updated", project.updated_at],
          ]}
        />
      </div>
    </Page>
  );
}
