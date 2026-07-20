import { createFileRoute } from "@tanstack/react-router";
import { Alert } from "@zitadel/ui-react";
import { LayoutGrid } from "lucide-react";

import { api, projectId } from "../../api/zitadel";
import { Page } from "../../components/layout";
import { KeyValueTable, PageHeader } from "../../components/resource-page";

export const Route = createFileRoute("/projects/")({
  staticData: { nav: { label: "Projects", order: 1, icon: LayoutGrid, count: "10,000" } },
  loader: () => api.getProject(projectId),
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
            ["Created", project.createdAt],
            ["Updated", project.updatedAt],
          ]}
        />
      </div>
    </Page>
  );
}
