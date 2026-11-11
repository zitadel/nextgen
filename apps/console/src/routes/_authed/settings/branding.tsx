import { createFileRoute } from "@tanstack/react-router";
import { Paintbrush } from "lucide-react";

import { BrandingScreen } from "@/features/branding/components/branding-screen";
import { loadBranding } from "@/features/branding/load";
import { requirePlatformRoot } from "@/features/platform/access";
import { ManagedProject } from "@/features/projects/project-scope";

/**
 * Root Settings → Branding: how the console's own sign-in looks, the reserved
 * platform project's branding (D41), drawn by the project screen's components.
 * Listed for someone who may act on that project; the selected project stays
 * selected (D36).
 */
export const Route = createFileRoute("/_authed/settings/branding")({
  staticData: {
    platformRoot: true,
    nav: { label: "Branding", view: "settings", order: 13, icon: Paintbrush },
  },
  beforeLoad: requirePlatformRoot,
  loader: ({ context }) => loadBranding(context.platformProjectId),
  component: function PlatformBranding() {
    const { platformProjectId } = Route.useRouteContext();
    return (
      <ManagedProject id={platformProjectId}>
        <BrandingScreen {...Route.useLoaderData()} />
      </ManagedProject>
    );
  },
});
