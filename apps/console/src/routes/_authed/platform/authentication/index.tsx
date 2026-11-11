import { createFileRoute } from "@tanstack/react-router";
import { Shield } from "lucide-react";
import { useCallback } from "react";

import { AuthenticationScreen } from "@/features/authentication/components/authentication-screen";
import { loadAuthentication } from "@/features/authentication/load";
import {
  type AuthenticationSearch,
  validateAuthenticationSearch,
} from "@/features/authentication/model";
import { requirePlatformRoot } from "@/features/platform/access";
import { ManagedProject } from "@/features/projects/project-scope";

/**
 * Authentication at the root: how people sign in to the console, the
 * reserved platform project's sign-in methods and identity providers (D41),
 * drawn by the project screen's components. Listed for someone who may act on
 * that project; the selected project stays selected (D36), and a connection
 * opens the root's page for it, never the project's.
 */
export const Route = createFileRoute("/_authed/platform/authentication/")({
  staticData: {
    platformRoot: true,
    nav: { label: "Authentication", view: "account", order: 3, icon: Shield },
  },
  validateSearch: validateAuthenticationSearch,
  beforeLoad: requirePlatformRoot,
  loader: ({ context }) => loadAuthentication(context.platformProjectId),
  component: function PlatformAuthentication() {
    const { platformProjectId } = Route.useRouteContext();
    const navigate = Route.useNavigate();
    const onTabChange = useCallback(
      (tab: AuthenticationSearch["tab"], replace?: boolean) =>
        void navigate({ search: tab ? { tab } : {}, replace }),
      [navigate],
    );
    return (
      <ManagedProject id={platformProjectId}>
        <AuthenticationScreen
          loaded={Route.useLoaderData()}
          tab={Route.useSearch().tab}
          onTabChange={onTabChange}
          detail="/platform/authentication/idps/$idpId"
          empty={{
            signInMethods: "The console's user schema enables no sign-in method.",
            identityProviders: "The console has no identity providers.",
          }}
        />
      </ManagedProject>
    );
  },
});
