import { createFileRoute } from "@tanstack/react-router";
import { Paintbrush } from "lucide-react";

import { BrandingScreen } from "@/features/branding/components/branding-screen";
import { loadBranding } from "@/features/branding/load";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";

export const Route = createFileRoute("/_authed/branding/")({
  // Order 6: right after Login flows, whose screens it styles, as the design's
  // single-level sidebar places it.
  staticData: {
    scope: "project",
    nav: { label: "Branding", order: 6, icon: Paintbrush },
  },
  loaderDeps: projectScopeDeps,
  loader: ({ deps }) => loadBranding(requireProjectScope(deps.project)),
  component: function ProjectBranding() {
    return <BrandingScreen {...Route.useLoaderData()} />;
  },
});
