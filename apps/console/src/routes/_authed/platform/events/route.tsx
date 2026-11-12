import { createFileRoute, useParams, useRouteContext } from "@tanstack/react-router";

import { EventsScreen } from "@/features/events/components/events-screen";
import { loadEvents } from "@/features/events/load";
import { parseEventsSearch } from "@/features/events/model";
import { requirePlatformRoot } from "@/features/platform/access";
import { ManagedProject } from "@/features/projects/project-scope";

/**
 * Events at the root: the reserved platform project's events (D41), newest
 * first: the sign-ins of the people who use the platform, the changes to its
 * users and the API requests made in it. They are events as a project's are,
 * so this is the project's Events screen with the platform project's id: the
 * same views and filters in the sidebar, the same search, Live, Refresh and
 * Export. A row of the root sidebar for someone who may act on that project,
 * and the selected project stays in the URL (D36).
 *
 * An event opens in the drawer over the list (`$eventId`, this route's
 * child), which never reads the list again, and every link stays on the
 * root's routes: nothing leads into a project's Events.
 */
export const Route = createFileRoute("/_authed/platform/events")({
  // On the layout, so the list and an event's drawer are both root pages.
  staticData: { platformRoot: true },
  validateSearch: parseEventsSearch,
  beforeLoad: requirePlatformRoot,
  // The list's filters, not the drawer's event, as on a project's Events.
  // Nor the selection, which this page does not read.
  loaderDeps: ({ search: { project: _project, ...deps } }) => deps,
  loader: ({ context, deps }) => loadEvents(context.platformProjectId, deps),
  component: PlatformEvents,
});

function PlatformEvents() {
  const { platformProjectId } = Route.useRouteContext();
  const { eventId } = useParams({ strict: false });
  const { session } = useRouteContext({ from: "/_authed" });
  return (
    <ManagedProject id={platformProjectId}>
      <EventsScreen
        home="/platform/events"
        projectId={platformProjectId}
        loaded={Route.useLoaderData()}
        search={Route.useSearch()}
        eventId={eventId}
        me={session.user_id || undefined}
      />
    </ManagedProject>
  );
}
