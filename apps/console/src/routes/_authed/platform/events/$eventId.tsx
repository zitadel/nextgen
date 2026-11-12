import { createFileRoute } from "@tanstack/react-router";

import {
  EventPanel,
  EventPanelError,
  EventPanelPending,
} from "@/features/events/components/event-panel";
import { loadEvent } from "@/features/events/load";

/**
 * One event of the root's Events, in the drawer over its list, as
 * `/events/$eventId` is the project list's child: the platform project's
 * event (D41), read with the id `requirePlatformRoot` put in the context.
 * The events it belongs with open in the same drawer, and its links narrow
 * the root's list: nothing in it leads into a project's Events.
 */
export const Route = createFileRoute("/_authed/platform/events/$eventId")({
  staticData: { resource: "event" },
  loader: ({ params, context }) => loadEvent(context.platformProjectId, params.eventId),
  pendingComponent: EventPanelPending,
  // Retention deletes an event by age, so a kept link can outlive one.
  errorComponent: ({ error }) => (
    <EventPanelError error={error} notFound="The platform holds no event with this ID." />
  ),
  component: function PlatformEvent() {
    return <EventPanel {...Route.useLoaderData()} />;
  },
});
