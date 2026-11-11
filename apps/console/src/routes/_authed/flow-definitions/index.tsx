import { createFileRoute } from "@tanstack/react-router";
import { Workflow } from "lucide-react";

import { LoginFlowsScreen } from "@/features/flow-definitions/components/login-flows-screen";
import { loadLoginFlows } from "@/features/flow-definitions/load";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";

export const Route = createFileRoute("/_authed/flow-definitions/")({
  // Order 5: Users sits at 3, Authentication at 4.
  staticData: { scope: "project", nav: { label: "Login flows", order: 5, icon: Workflow } },
  loaderDeps: projectScopeDeps,
  loader: ({ deps }) => loadLoginFlows(requireProjectScope(deps.project)),
  component: function ProjectLoginFlows() {
    return (
      <LoginFlowsScreen
        {...Route.useLoaderData()}
        detailTo="/flow-definitions/$definitionId"
        schemaTo="/schemas/$schemaId"
      />
    );
  },
});
