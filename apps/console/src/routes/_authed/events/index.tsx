import { createFileRoute } from "@tanstack/react-router";
import { Logs } from "lucide-react";

/**
 * Events with no event open: the list alone. The list is the layout route's
 * (`route.tsx`), so an event's drawer opens over it without reading it again;
 * this route is where the sidebar's Events entry points.
 */
export const Route = createFileRoute("/_authed/events/")({
  // After Authentication, before Settings: the last of the project's
  // contents, and what the screens above it did.
  staticData: { scope: "project", nav: { label: "Events", order: 9, icon: Logs } },
  component: () => null,
});
