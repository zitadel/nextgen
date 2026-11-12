import { createFileRoute } from "@tanstack/react-router";
import { Logs } from "lucide-react";

/**
 * The root's Events with no event open: the list alone. The list is the
 * layout route's (`route.tsx`), so an event's drawer opens over it without
 * reading it again; this route is where the root sidebar's entry points.
 */
export const Route = createFileRoute("/_authed/platform/events/")({
  // Order 3: after Users, as what they did, and before Settings. The glyph
  // of a project's Events, since it is that screen.
  staticData: {
    platformRoot: true,
    nav: { label: "Events", view: "account", order: 3, icon: Logs },
  },
  component: () => null,
});
