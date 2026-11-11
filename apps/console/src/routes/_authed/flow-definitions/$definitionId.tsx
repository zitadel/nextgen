import { createFileRoute } from "@tanstack/react-router";

import { FlowDefinitionScreen } from "@/features/flow-definitions/components/flow-definition-screen";
import { loadFlowDefinition } from "@/features/flow-definitions/load";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";

export const Route = createFileRoute("/_authed/flow-definitions/$definitionId")({
  staticData: { scope: "project", resource: "login flow" },
  loaderDeps: projectScopeDeps,
  loader: ({ params, deps }) =>
    loadFlowDefinition(params.definitionId, requireProjectScope(deps.project)),
  component: function ProjectFlowDefinition() {
    const { definitionId } = Route.useParams();
    return (
      <FlowDefinitionScreen
        {...Route.useLoaderData()}
        definitionId={definitionId}
        schemaTo="/schemas/$schemaId"
      />
    );
  },
});
