import { createFileRoute } from "@tanstack/react-router";

import { api, projectId } from "../../api/zitadel";
import { PageHeader } from "../../components/resource-page";

export const Route = createFileRoute("/flow-definitions/$definitionId")({
  loader: ({ params }) => api.getFlowDefinition(params.definitionId, { project_id: projectId }),
  component: FlowDefinitionDetail,
});

function FlowDefinitionDetail() {
  const definition = Route.useLoaderData();

  return (
    <>
      <PageHeader title="Flow definition" description={definition.id} />
      {/* prettier-ignore */}
      <pre className="overflow-auto rounded-lg border border-zl-border-default-gray-100 bg-zl-surface-default-primary-gray p-4 text-xs">{JSON.stringify(definition, null, 2)}</pre>
    </>
  );
}
