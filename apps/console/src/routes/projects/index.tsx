import { createFileRoute } from "@tanstack/react-router";

import { api, projectId } from "../../api/zitadel";
import { KeyValueTable, PageHeader } from "../../components/resource-page";

export const Route = createFileRoute("/projects/")({
  staticData: { nav: { group: "Configuration", label: "Projects", order: 1 } },
  loader: () => api.getProject(projectId),
  component: ProjectView,
});

function ProjectView() {
  const project = Route.useLoaderData();

  return (
    <>
      <PageHeader title="Project" description={project.id} />
      <KeyValueTable
        rows={[
          ["ID", project.id],
          ["Created", project.createdAt],
          ["Updated", project.updatedAt],
        ]}
      />
    </>
  );
}
