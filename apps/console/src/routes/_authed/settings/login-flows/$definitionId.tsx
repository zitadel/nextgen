import { createFileRoute } from "@tanstack/react-router";

import { FlowDefinitionScreen } from "@/features/flow-definitions/components/flow-definition-screen";
import { loadFlowDefinition } from "@/features/flow-definitions/load";
import { requirePlatformRoot } from "@/features/platform/access";
import { ManagedProject } from "@/features/projects/project-scope";

/**
 * One of the reserved platform project's flow definitions, opened from root
 * Settings → Login flows (D41). Its schema is named in that project and not
 * linked, as the root shows no schemas.
 */
export const Route = createFileRoute("/_authed/settings/login-flows/$definitionId")({
  staticData: { platformRoot: true, resource: "login flow" },
  beforeLoad: requirePlatformRoot,
  loader: ({ params, context }) =>
    loadFlowDefinition(params.definitionId, context.platformProjectId),
  component: function PlatformFlowDefinition() {
    const { platformProjectId } = Route.useRouteContext();
    const { definitionId } = Route.useParams();
    return (
      <ManagedProject id={platformProjectId}>
        <FlowDefinitionScreen {...Route.useLoaderData()} definitionId={definitionId} />
      </ManagedProject>
    );
  },
});
