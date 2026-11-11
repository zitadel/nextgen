import { createFileRoute } from "@tanstack/react-router";
import { Paintbrush } from "lucide-react";

import { BrandingScreen } from "@/features/branding/components/branding-screen";
import { loadBranding } from "@/features/branding/load";
import { requirePlatformRoot } from "@/features/platform/access";
import { ManagedProject } from "@/features/projects/project-scope";

/**
 * Branding at the root: how the console's own sign-in looks, the reserved
 * platform project's branding (D41), drawn by the project screen's components.
 * A row of the root sidebar for someone who may act on that project; the
 * selected project stays in the URL (D36), and the pill says the root.
 */
export const Route = createFileRoute("/_authed/platform/branding")({
  staticData: {
    platformRoot: true,
    nav: { label: "Branding", view: "account", order: 5, icon: Paintbrush },
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
