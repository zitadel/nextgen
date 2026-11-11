import { createFileRoute } from "@tanstack/react-router";
import { Shield } from "lucide-react";
import { useCallback } from "react";

import { AuthenticationScreen } from "@/features/authentication/components/authentication-screen";
import { loadAuthentication } from "@/features/authentication/load";
import {
  type AuthenticationSearch,
  validateAuthenticationSearch,
} from "@/features/authentication/model";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";

/**
 * Authentication: the selected project's sign-in methods and identity
 * provider connections. The open tab is in the URL (`?tab=`).
 */
export const Route = createFileRoute("/_authed/authentication/")({
  // After Deployments, as the design's single-level sidebar places it.
  staticData: { scope: "project", nav: { label: "Authentication", order: 8, icon: Shield } },
  validateSearch: validateAuthenticationSearch,
  loaderDeps: projectScopeDeps,
  loader: ({ deps }) => loadAuthentication(requireProjectScope(deps.project)),
  component: function ProjectAuthentication() {
    const navigate = Route.useNavigate();
    const onTabChange = useCallback(
      (tab: AuthenticationSearch["tab"], replace?: boolean) =>
        void navigate({ search: tab ? { tab } : {}, replace }),
      [navigate],
    );
    return (
      <AuthenticationScreen
        loaded={Route.useLoaderData()}
        tab={Route.useSearch().tab}
        onTabChange={onTabChange}
        detail="/authentication/idps/$idpId"
      />
    );
  },
});
