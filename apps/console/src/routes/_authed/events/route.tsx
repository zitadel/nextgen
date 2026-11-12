import { createFileRoute, useParams, useRouteContext } from "@tanstack/react-router";

import { EventsScreen } from "@/features/events/components/events-screen";
import { loadEvents } from "@/features/events/load";
import { parseEventsSearch } from "@/features/events/model";
import { requireProjectScope, useRequiredProjectScope } from "@/features/projects/project-scope";

/**
 * Events: the project's events, newest first, on the shared resource table
 * (D17, D30, D38), drawn by `EventsScreen`, which the root's Events of the
 * platform project shares (D41). An event is what the server recorded of a
 * sign-in step, a change to a record or an API request (`GET /events`), and
 * the screen, the route, the API and the CLI all call it that.
 *
 * A row names the event's type, what it was about, who caused it and when it
 * happened, to the millisecond, which tells the events of one request apart.
 * A failure (a failure type, a request answered with 5xx) is tinted. A row
 * opens the event in a drawer over the list (`$eventId`, this route's child),
 * as Vercel's Logs opens a request: the list keeps its rows, its scroll and
 * its pages, and the drawer steps through them.
 *
 * Which events are listed is chosen in the sidebar, whose list Events replaces
 * with its own (`EventViewPicker`, `EventFilters`): the view (audit events, the
 * default; API requests; both), then the filters. They live in the URL, the
 * drawer's included: they are server-side, so they belong to the request the
 * loader makes. Any of them combine: the server bounds every read, and a
 * combination no single index holds is matched over a fixed number of events
 * a request. Such a page can come back short, or empty, and still have more
 * behind it. The list then says that not every event was read, and its
 * button reads **Keep looking**.
 *
 * The search, on a row of its own under the title, holds the filters set by a pasted value, as
 * chips: an id, an event type, an operation, or a filter named before its
 * value (`EventSearchField`). Its empty field offers **My activity**, the list
 * narrowed to what the signed-in person did. A row's menu narrows the list by
 * a value the row carries. While the sidebar is an icon rail, on a phone or
 * collapsed, a button beside the search names the view and opens it.
 *
 * The list is a snapshot of the moment it loaded: **Refresh** reads it again
 * from the newest event, and **Live** adds what is recorded after it every
 * few seconds (`useLiveEvents`): a green dot marks it on, a line under the
 * toolbar says when it last read, and the rows it adds fade in. It asks the
 * server again rather than holding a stream open, one range of an index a
 * read, which every dialect serves. The time range is counted back from the
 * moment it loaded, and `Load more` keeps it, so a page never slides past
 * rows the range dropped. **Export** copies or downloads the rows loaded.
 */
export const Route = createFileRoute("/_authed/events")({
  validateSearch: parseEventsSearch,
  // The project and the list's filters, not the drawer's event: opening one
  // must not read the list again.
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadEvents(requireProjectScope(deps.project), deps),
  component: ProjectEvents,
});

function ProjectEvents() {
  const projectId = useRequiredProjectScope();
  const search = Route.useSearch();
  const { eventId } = useParams({ strict: false });
  const { session } = useRouteContext({ from: "/_authed" });

  return (
    <EventsScreen
      home="/events"
      projectId={projectId}
      loaded={Route.useLoaderData()}
      search={search}
      eventId={eventId}
      me={session.user_id || undefined}
    />
  );
}
