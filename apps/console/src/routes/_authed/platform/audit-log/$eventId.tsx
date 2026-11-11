import { createFileRoute } from "@tanstack/react-router";

import {
  EventPanel,
  EventPanelError,
  EventPanelPending,
} from "@/features/events/components/event-panel";
import { loadEvent } from "@/features/events/load";

/**
 * One event of the Audit log, in the drawer over the root's list, as
 * `/events/$eventId` is the project list's child: the platform project's
 * event (D41), read with the id `requirePlatformRoot` put in the context.
 * Its request's steps open in the same drawer; nothing in it leads into a
 * project's Events.
 */
export const Route = createFileRoute("/_authed/platform/audit-log/$eventId")({
  staticData: { resource: "event" },
  loader: ({ params, context }) => loadEvent(context.platformProjectId, params.eventId),
  pendingComponent: EventPanelPending,
  // Retention deletes an event by age, so a kept link can outlive one.
  errorComponent: ({ error }) => (
    <EventPanelError error={error} notFound="The audit log holds no event with this ID." />
  ),
  component: function PlatformAuditEvent() {
    return <EventPanel {...Route.useLoaderData()} />;
  },
});
