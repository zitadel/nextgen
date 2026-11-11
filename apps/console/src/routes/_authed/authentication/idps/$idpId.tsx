import { createFileRoute } from "@tanstack/react-router";

import { IdpDetailScreen } from "@/features/authentication/components/idp-detail-screen";
import { loadIdpDetail } from "@/features/authentication/load";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";

/** One identity provider connection of the selected project. */
export const Route = createFileRoute("/_authed/authentication/idps/$idpId")({
  staticData: { scope: "project", resource: "identity provider" },
  loaderDeps: projectScopeDeps,
  loader: ({ params, deps }) => loadIdpDetail(requireProjectScope(deps.project), params.idpId),
  component: function ProjectIdpDetail() {
    return (
      <IdpDetailScreen
        {...Route.useLoaderData()}
        schemaDetail="/schemas/$schemaId"
        flowDetail="/flow-definitions/$definitionId"
      />
    );
  },
});
