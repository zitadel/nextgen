import { createFileRoute } from "@tanstack/react-router";
import { getProjectEvent, listFlowEvents, listRequestEvents } from "@/features/events/api";
import {
  EventPanel,
  EventPanelMessage,
  EventPanelPending,
} from "@/features/events/components/event-panel";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { ApiError } from "@zitadel/api/runtime/fetch";
import { describeError } from "@/lib/api-error";

/**
 * One event, in the drawer over Logs' list (`EventSheet`, drawn by the list's
 * route): a row opens it, the overview's recent activity links to it, and a
 * link to it opens the list beside it under the filters it carries.
 *
 * Beside the event the drawer lists the events it belongs with, oldest first:
 * - An event of a login flow gets the whole flow, one range of the flow index:
 *   every call of the sign-in, its checks, and the session and token it ended
 *   in. Its request's events are among them.
 * - Any other event gets its request's, one range of the request index: what
 *   an API call changed, or which call a change came from.
 *
 * An event is read-only: nothing here edits or removes it.
 */
export const Route = createFileRoute("/_authed/events/$eventId")({
  staticData: { scope: "project", resource: "event" },
  loaderDeps: projectScopeDeps,
  loader: async ({ params, deps }) => {
    const projectId = requireProjectScope(deps.project);
    const event = await getProjectEvent(projectId, params.eventId);
    if (event.flow_id) {
      return { event, flow: await listFlowEvents(projectId, event.flow_id) };
    }
    const request = event.request_id
      ? await listRequestEvents(projectId, event.request_id)
      : undefined;
    return { event, request };
  },
  pendingComponent: EventPanelPending,
  errorComponent: EventError,
  component: EventScreen,
});

function EventScreen() {
  const { event, request, flow } = Route.useLoaderData();
  return <EventPanel event={event} request={request} flow={flow} />;
}

/**
 * The drawer when its event cannot be read: gone (retention deletes events by
 * age, so a kept link can outlive one), never this project's, or the server
 * failed. Its close leads back to the list.
 */
function EventError({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.status === 404) {
    return (
      <EventPanelMessage title="Event not found">
        This project holds no event with this ID.
      </EventPanelMessage>
    );
  }
  return (
    <EventPanelMessage title="Event">
      {describeError(error, "Could not load this event.")}
    </EventPanelMessage>
  );
}
