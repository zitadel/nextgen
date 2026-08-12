import { createFileRoute } from "@tanstack/react-router";

import { api } from "../../../api/zitadel";
import { Page } from "../../../components/layout";
import { PageHeader } from "../../../components/resource-page";

export const Route = createFileRoute("/_authed/flow-definitions/$definitionId")({
  loader: ({ params }) => api.getFlowDefinition(params.definitionId),
  component: FlowDefinitionDetail,
});

function FlowDefinitionDetail() {
  const definition = Route.useLoaderData();

  return (
    <Page>
      <PageHeader title="Flow definition" description={definition.id} />
      {/* prettier-ignore */}
      <pre className="overflow-auto rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">{JSON.stringify(definition, null, 2)}</pre>
    </Page>
  );
}
