import { createFileRoute } from "@tanstack/react-router";
import { Workflow } from "lucide-react";

import { LoginFlowsScreen } from "@/features/flow-definitions/components/login-flows-screen";
import { loadLoginFlows } from "@/features/flow-definitions/load";
import { requirePlatformRoot } from "@/features/platform/access";
import { ManagedProject } from "@/features/projects/project-scope";

/**
 * Login flows at the root: how people sign in to the console, the
 * reserved platform project's flows (D41), drawn by the project screen's
 * components. Its rows open the root's own detail, and its schemas are named,
 * not linked, as the root shows none. Listed for someone who may act on that
 * project; the selected project stays selected (D36).
 */
export const Route = createFileRoute("/_authed/platform/login-flows/")({
  // Order 4: after People and Authentication, before Branding (5), which
  // styles these flows, as D41 lists them and as a project's sidebar does.
  staticData: {
    platformRoot: true,
    nav: { label: "Login flows", view: "account", order: 4, icon: Workflow },
  },
  beforeLoad: requirePlatformRoot,
  loader: ({ context }) => loadLoginFlows(context.platformProjectId),
  component: function PlatformLoginFlows() {
    const { platformProjectId } = Route.useRouteContext();
    return (
      <ManagedProject id={platformProjectId}>
        <LoginFlowsScreen
          {...Route.useLoaderData()}
          detailTo="/platform/login-flows/$definitionId"
          hint="The server deploys the console's login flows each time it starts."
          empty="The console has no login flows."
        />
      </ManagedProject>
    );
  },
});
