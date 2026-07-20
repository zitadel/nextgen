import { createFileRoute } from "@tanstack/react-router";

import { api, projectId } from "../../api/zitadel";
import { Page } from "../../components/layout";
import { PageHeader } from "../../components/resource-page";

export const Route = createFileRoute("/flow-definitions/$definitionId")({
  loader: ({ params }) => api.getFlowDefinition(params.definitionId, { project_id: projectId }),
  component: FlowDefinitionDetail,
});

function FlowDefinitionDetail() {
  const definition = Route.useLoaderData();

  return (
    <Page>
      <PageHeader title="Flow definition" description={definition.id} />
      {/* prettier-ignore */}
      <pre className="overflow-auto rounded-zl-l border border-zl-border-subtle bg-zl-surface-raised p-4 text-xs text-zl-text-secondary">{JSON.stringify(definition, null, 2)}</pre>
    </Page>
  );
}
