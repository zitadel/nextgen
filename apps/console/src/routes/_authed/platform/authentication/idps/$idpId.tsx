import { createFileRoute } from "@tanstack/react-router";

import { IdpDetailScreen } from "@/features/authentication/components/idp-detail-screen";
import { loadIdpDetail } from "@/features/authentication/load";
import { requirePlatformRoot } from "@/features/platform/access";
import { ManagedProject } from "@/features/projects/project-scope";

/**
 * One identity provider of the reserved platform project, opened from the
 * root's Authentication (D41). Its login flows open the root's Login flows;
 * its user schemas read as text, since the root shows no schemas (D41).
 */
export const Route = createFileRoute("/_authed/platform/authentication/idps/$idpId")({
  staticData: { platformRoot: true, resource: "identity provider" },
  beforeLoad: requirePlatformRoot,
  loader: ({ params, context }) => loadIdpDetail(context.platformProjectId, params.idpId),
  component: function PlatformIdpDetail() {
    const { platformProjectId } = Route.useRouteContext();
    return (
      <ManagedProject id={platformProjectId}>
        <IdpDetailScreen
          {...Route.useLoaderData()}
          flowDetail="/platform/login-flows/$definitionId"
        />
      </ManagedProject>
    );
  },
});
