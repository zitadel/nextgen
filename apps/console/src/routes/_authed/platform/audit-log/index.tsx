import { createFileRoute } from "@tanstack/react-router";
import { ScrollText } from "lucide-react";

/**
 * The Audit log with no event open: the list alone. The list is the layout
 * route's (`route.tsx`), so an event's drawer opens over it without reading it
 * again; this route is where the root sidebar's entry points.
 */
export const Route = createFileRoute("/_authed/platform/audit-log/")({
  // Order 6: the last of the platform project's pages (D41), after Branding,
  // as the audit trail of what the pages above it set.
  staticData: {
    platformRoot: true,
    nav: { label: "Audit log", view: "account", order: 6, icon: ScrollText },
  },
  component: () => null,
});
