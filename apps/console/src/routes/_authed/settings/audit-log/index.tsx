import { createFileRoute } from "@tanstack/react-router";
import { ScrollText } from "lucide-react";

/**
 * The Audit log with no event open: the list alone. The list is the layout
 * route's (`route.tsx`), so an event's drawer opens over it without reading it
 * again; this route is where the Settings list's entry points.
 */
export const Route = createFileRoute("/_authed/settings/audit-log/")({
  // Order 14: the last of the platform project's pages (D41), after Branding,
  // as the audit trail of what the pages above it set.
  staticData: {
    platformRoot: true,
    nav: { label: "Audit log", view: "settings", order: 14, icon: ScrollText },
  },
  component: () => null,
});
