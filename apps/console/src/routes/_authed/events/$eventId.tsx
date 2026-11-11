import { createFileRoute } from "@tanstack/react-router";

import {
  EventPanel,
  EventPanelError,
  EventPanelPending,
} from "@/features/events/components/event-panel";
import { loadEvent } from "@/features/events/load";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";

/**
 * One event, in the drawer over Events' list (`EventSheet`, drawn by the list's
 * route): a row opens it, the overview's recent activity links to it, and a
 * link to it opens the list beside it under the filters it carries.
 *
 * Beside the event the drawer lists the other events of its request, oldest
 * first, one range of the request index: what an API call changed, or which
 * call a change came from. An event is read-only: nothing here edits or
 * removes it.
 */
export const Route = createFileRoute("/_authed/events/$eventId")({
  staticData: { scope: "project", resource: "event" },
  loaderDeps: projectScopeDeps,
  loader: ({ params, deps }) => loadEvent(requireProjectScope(deps.project), params.eventId),
  pendingComponent: EventPanelPending,
  // Retention deletes an event by age, so a kept link can outlive one.
  errorComponent: ({ error }) => (
    <EventPanelError error={error} notFound="This project holds no event with this ID." />
  ),
  component: function ProjectEvent() {
    return <EventPanel {...Route.useLoaderData()} />;
  },
});
