import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  useParams,
  useRouteContext,
  useRouter,
} from "@tanstack/react-router";
import { Download, ListFilter, Logs, Radio, RefreshCw, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { FormError } from "@/components/form-error";
import { IdText } from "@/components/id-text";
import { Page } from "@/components/layout";
import {
  LoadMore,
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_ROW_ICON,
  RESOURCE_ROW_LINK,
  RESOURCE_TABLE_FIXED,
  RESOURCE_TABLE_TOP,
  RESOURCE_TABLE_WRAP,
  ResourceEmptyRow,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceMenuHead,
  ResourceRow,
  ResourceTitle,
  RowMenu,
} from "@/components/resource-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { listProjectEvents } from "@/features/events/api";
import { EventSheet, LogRowsContext } from "@/features/events/components/event-panel";
import { EventSearch } from "@/features/events/components/event-search";
import { EventSubject } from "@/features/events/components/event-subject";
import { copyEvents, downloadEvents } from "@/features/events/export";
import {
  around,
  eventFilterValues,
  filterCount,
  isFailure,
  isNarrowed,
  isNarrowedTo,
  type LogEvent,
  type LogsSearch,
  type LogView,
  narrowedBy,
  parseLogsSearch,
  rangeStart,
  VIEW_LABEL,
} from "@/features/events/model";
import { useLiveEvents } from "@/features/events/use-live-events";
import { requireProjectScope, useRequiredProjectScope } from "@/features/projects/project-scope";
import { useLoadMore } from "@/hooks/use-load-more";
import { formatLogTime } from "@/lib/date";
import { LIST_PAGE_SIZE } from "@/lib/paging";
import { cn } from "@/lib/utils";

/**
 * Logs: the project's events, newest first, on the shared resource table
 * (D17, D30). An event is what the server recorded of a sign-in step, a
 * change to a record or an API request (`GET /events`); the API and the CLI
 * call them events, and the route keeps that name.
 *
 * A row names the event's type, what it was about, who caused it and when it
 * happened, to the millisecond, which tells the events of one request apart.
 * A failure (a failure type, a request answered with 5xx) is tinted. A row
 * opens the event in a drawer over the list (`$eventId`, this route's child),
 * as Vercel's Logs opens a request: the list keeps its rows, its scroll and
 * its pages, and the drawer steps through them.
 *
 * Which events are listed is chosen in the sidebar, whose list Logs replaces
 * with its own (`LogViewRows`, `LogFilters`): the view (audit events, the
 * default; API requests; both), then the filters. They live in the URL, the
 * drawer's included: they are server-side, so they belong to the request the
 * loader makes. Any of them combine: the server bounds every read, and a
 * combination no single index holds is matched over a fixed number of events
 * a request. Such a page can come back short, or empty, and still have more
 * behind it. The list then says that not every event was read, and its
 * button reads **Keep looking**.
 *
 * The search above the table takes one id or one event type and sets the
 * filter it names (`EventSearch`). **My activity** narrows the list to what
 * the signed-in person did. A row's menu narrows the list by a value the row
 * carries. While the sidebar is an icon rail, on a phone or collapsed, a
 * button beside the search names the view and opens it.
 *
 * The list is a snapshot of the moment it loaded: **Refresh** reads it again
 * from the newest event, and **Live** adds what is recorded after it every
 * few seconds (`useLiveEvents`). The time range is counted back from the
 * moment it loaded, and `Load more` keeps it, so a page never slides past
 * rows the range dropped. **Export** copies or downloads the rows loaded.
 */
export const Route = createFileRoute("/_authed/events")({
  validateSearch: parseLogsSearch,
  // The project and the list's filters, not the drawer's event: opening one
  // must not read the list again.
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const createdAfter = rangeStart(deps.since, new Date());
    const page = await listProjectEvents(requireProjectScope(deps.project), deps, {
      createdAfter,
    });
    // The filters and the range's start the page answers: `Load more`
    // continues these, not the ones a newer navigation is on its way to.
    return { ...page, search: deps, createdAfter };
  },
  component: LogsScreen,
});

/** The empty table's sentence, by what was asked for. */
const NOTHING: Record<LogView, string> = {
  audit: "This project has no audit events.",
  requests: "This project has no API requests.",
  all: "This project has no events.",
};

/** Above the button, while a page came back short of its size with more behind it. */
const NOT_ALL_READ = "Not every event has been read yet for these filters.";

function LogsScreen() {
  const projectId = useRequiredProjectScope();
  const loaded = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const navigate = useNavigate();
  const { eventId } = useParams({ strict: false });
  const [refreshing, setRefreshing] = useState(false);

  // How many rows the newest page held, and of which load: a page that lands
  // after the list was read again says nothing about the one on screen.
  const [newest, setNewest] = useState({ of: loaded, rows: loaded.items.length });
  const paging = useLoadMore(
    loaded,
    (pageToken) =>
      listProjectEvents(projectId, loaded.search, {
        createdAfter: loaded.createdAfter,
        pageToken,
      }),
    "Could not load more events.",
    (page) => setNewest({ of: loaded, rows: page.items.length }),
  );
  // A range that has ended has nothing newer to follow.
  const canGoLive = !loaded.search.to;
  const live = useLiveEvents({
    projectId,
    search: loaded.search,
    loaded,
    newest: loaded.items[0],
    enabled: canGoLive,
  });
  const events = useMemo(
    () => [...live.events, ...loaded.items, ...paging.extra],
    [live.events, loaded.items, paging.extra],
  );
  // A page short of its size that still has a token: the server stopped at
  // its bound, not at the end of the events (root ADR 048).
  const newestRows = newest.of === loaded ? newest.rows : loaded.items.length;
  const stoppedShort = paging.hasMore && newestRows < LIST_PAGE_SIZE;

  async function refresh() {
    setRefreshing(true);
    try {
      await router.invalidate();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <LogRowsContext.Provider value={{ rows: events, search }}>
      <Page>
        <ResourceTitle
          filter={
            <>
              <SidebarFilters search={search} />
              <EventSearch current={search} />
              <MyActivity search={search} />
            </>
          }
          action={
            <div className="flex items-center gap-2">
              {canGoLive && (
                <Button
                  variant={live.on ? "default" : "secondary"}
                  className="shrink-0 gap-1.5 px-2.5!"
                  aria-pressed={live.on}
                  onClick={live.toggle}
                >
                  <Radio aria-hidden className={cn(live.on && "animate-pulse")} />
                  Live
                </Button>
              )}
              {/* `px-2.5!`: `Button`'s `has-[>svg]:px-3` out-specifies a plain
                  `px-2.5`. */}
              <Button
                variant="secondary"
                className="shrink-0 gap-1.5 px-2.5!"
                onClick={() => void refresh()}
                loading={refreshing}
              >
                <RefreshCw aria-hidden />
                Refresh
              </Button>
              <ExportMenu events={events} />
            </div>
          }
        >
          Logs
        </ResourceTitle>

        <FormError message={live.error} className="mt-3" />

        <div className={`${RESOURCE_TABLE_WRAP} ${RESOURCE_TABLE_TOP}`}>
          {/* An event type runs to thirty characters, and the time must show
              its milliseconds, which tell the events of one request apart.
              The table keeps the width both need and scrolls in its card
              below it; a quarter of that width is a timestamp with its
              inset. */}
          <Table className={cn(RESOURCE_TABLE_FIXED, "min-w-[60rem]")}>
            <TableHeader>
              <ResourceHeaderRow>
                <ResourceHeadCell className="w-[26%]">Event</ResourceHeadCell>
                <ResourceHeadCell className="w-[27%]">Details</ResourceHeadCell>
                <ResourceHeadCell className="w-[15%]">Actor</ResourceHeadCell>
                <ResourceHeadCell className="w-[26%]">Time</ResourceHeadCell>
                <ResourceMenuHead className="w-[6%] px-2" />
              </ResourceHeaderRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 ? (
                <ResourceEmptyRow colSpan={5}>
                  {/* Nothing yet is not nothing: more events are still unread. */}
                  {stoppedShort
                    ? "No events have matched so far."
                    : isNarrowed(loaded.search)
                      ? "No events match these filters."
                      : NOTHING[loaded.search.view]}
                </ResourceEmptyRow>
              ) : (
                events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    search={search}
                    selected={event.id === eventId}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <LoadMore
          paging={paging}
          label={stoppedShort ? "Keep looking" : undefined}
          note={stoppedShort ? NOT_ALL_READ : undefined}
        />
      </Page>

      <EventSheet
        open={eventId !== undefined}
        onClose={() => void navigate({ to: "/events", search })}
      >
        <Outlet />
      </EventSheet>
    </LogRowsContext.Provider>
  );
}

/**
 * The way to the views and filters while the sidebar is an icon rail, on a
 * phone or collapsed: the rail has no room for a field, and without its
 * labels it does not say which view is on. The button names the view and how
 * many filters narrow it, and opens the sidebar, where both are changed.
 * Beside an open sidebar it would repeat it, so it is not drawn.
 */
function SidebarFilters({ search }: { search: LogsSearch }) {
  const { isMobile, state, setOpen, setOpenMobile } = useSidebar();
  if (!isMobile && state === "expanded") return null;
  const count = filterCount(search);
  const filters = count === 1 ? "1 filter" : `${count} filters`;

  return (
    <Button
      variant="outline"
      className="shrink-0 gap-1.5 px-2.5!"
      aria-label={`Views and filters: ${VIEW_LABEL[search.view]}${count > 0 ? `, ${filters}` : ""}`}
      onClick={() => (isMobile ? setOpenMobile(true) : setOpen(true))}
    >
      <ListFilter aria-hidden />
      {VIEW_LABEL[search.view]}
      {count > 0 && <Badge variant="secondary">{count}</Badge>}
    </Button>
  );
}

/**
 * The list narrowed to what the signed-in person did, as Vercel's "My Logs":
 * the actor filter set to their user id, one range of the actor index. Pressed
 * while it is set; pressing it again clears it.
 */
function MyActivity({ search }: { search: LogsSearch }) {
  const { session } = useRouteContext({ from: "/_authed" });
  const me = session.user_id;
  if (!me) return null;
  const pressed = search.actor === me;
  return (
    <Button
      asChild
      variant={pressed ? "default" : "outline"}
      size="icon"
      className="shrink-0"
      aria-pressed={pressed}
      title="My activity"
    >
      <Link to="/events" search={narrowedBy(search, "actor", pressed ? undefined : me)}>
        <UserRound aria-hidden />
        <span className="sr-only">My activity</span>
      </Link>
    </Button>
  );
}

/**
 * The loaded rows copied or saved, as Vercel's Logs offers them: JSON as the
 * API returns each event, or CSV with the payload in one field. Only what the
 * list holds, Live's rows and the pages loaded included.
 */
function ExportMenu({ events }: { events: LogEvent[] }) {
  const empty = events.length === 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon" className="shrink-0" aria-label="Export">
          <Download aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem disabled={empty} onSelect={() => void copyEvents(events)}>
          Copy loaded events
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={empty} onSelect={() => downloadEvents(events, "json")}>
          Download JSON
        </DropdownMenuItem>
        <DropdownMenuItem disabled={empty} onSelect={() => downloadEvents(events, "csv")}>
          Download CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One event. The whole row opens it in the drawer; its menu narrows the list
 * by what it carries, or reads the minutes around it.
 */
function EventRow({
  event,
  search,
  selected,
}: {
  event: LogEvent;
  search: LogsSearch;
  /** Open in the drawer. */
  selected: boolean;
}) {
  const navigate = useNavigate();
  const params = { eventId: event.id };
  // A system actor has no id: its kind is all there is to name.
  const actor = event.actor_id || event.actor_type;
  // A value the list is narrowed to already would narrow it no further.
  const narrowings = eventFilterValues(event).filter(
    ({ filter, value }) => !isNarrowedTo(search, filter.key, value),
  );
  const failure = isFailure(event);

  return (
    <ResourceRow
      onOpen={() => void navigate({ to: "/events/$eventId", params, search })}
      data-state={selected ? "selected" : undefined}
      aria-selected={selected}
      className={cn(
        failure && "bg-destructive/5 hover:bg-destructive/10",
        selected && "bg-muted hover:bg-muted",
      )}
    >
      <TableCell className={RESOURCE_CELL}>
        <Link
          to="/events/$eventId"
          params={params}
          search={search}
          className={`${RESOURCE_ROW_LINK} max-w-full`}
        >
          <Logs
            aria-hidden
            strokeWidth={1.5}
            className={cn(RESOURCE_ROW_ICON, failure && "text-destructive")}
          />
          <span className={cn("truncate", failure && "text-destructive")} title={event.event_type}>
            {event.event_type}
          </span>
        </Link>
      </TableCell>
      <TableCell className={RESOURCE_CELL}>
        <EventSubject event={event} />
      </TableCell>
      <TableCell className={RESOURCE_CELL}>
        {actor ? (
          <IdText id={actor} title={actor} className="text-foreground text-sm" />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className={cn(RESOURCE_CELL_MUTED, "tabular-nums")}>
        <time dateTime={event.occurred_at}>{formatLogTime(event.occurred_at)}</time>
      </TableCell>
      {/* 8px inset, not the cells' 24px: the column is the menu's button and
          no wider. */}
      <TableCell className="h-14 px-2 py-2 text-right">
        <RowMenu name={`${event.event_type}, ${event.id}`} contentClassName="w-56">
          <DropdownMenuItem asChild>
            <Link to="/events/$eventId" params={params} search={search}>
              View event
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/events" search={around(event)}>
              Events around this one
            </Link>
          </DropdownMenuItem>
          {narrowings.length > 0 && <DropdownMenuSeparator />}
          {narrowings.map(({ filter, value }) => (
            <DropdownMenuItem key={filter.key} asChild>
              <Link to="/events" search={narrowedBy(search, filter.key, value)}>
                Only this {filter.name}
              </Link>
            </DropdownMenuItem>
          ))}
        </RowMenu>
      </TableCell>
    </ResourceRow>
  );
}
