import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  useParams,
  useRouteContext,
  useRouter,
} from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { FormError } from "@/components/form-error";
import { IdText } from "@/components/id-text";
import { Page } from "@/components/layout";
import {
  LoadMore,
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_DENSITY,
  RESOURCE_MENU_CELL_NARROW,
  RESOURCE_ROW_LINK,
  RESOURCE_STICKY_BODY,
  RESOURCE_STICKY_END,
  RESOURCE_TABLE_FIXED,
  RESOURCE_TABLE_SCROLL,
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
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { listProjectEvents } from "@/features/events/api";
import { EventSheet, EventRowsContext } from "@/features/events/components/event-panel";
import { EventSearchField } from "@/features/events/components/event-search-field";
import { ActorName, OutcomeBadge, UserName } from "@/features/events/components/event-people";
import { EventSubject, RequestStatus } from "@/features/events/components/event-subject";
import {
  ExportMenu,
  LiveDot,
  LiveStatus,
  SidebarFilters,
} from "@/features/events/components/events-toolbar";
import {
  abandonedAttempts,
  around,
  belongingWith,
  eventFilterValues,
  eventSubject,
  formatSpan,
  isFailure,
  isNarrowed,
  isNarrowedTo,
  type ProjectEvent,
  type EventsSearch,
  type EventView,
  NO_AUDIT_EVENTS,
  narrowedBy,
  olderUnmatched,
  parseEventsSearch,
  rangeStart,
  signinOf,
} from "@/features/events/model";
import { useLiveEvents } from "@/features/events/use-live-events";
import { useUserNames } from "@/features/events/use-user-names";
import { requireProjectScope, useRequiredProjectScope } from "@/features/projects/project-scope";
import { useLoadMore } from "@/hooks/use-load-more";
import { useScrollEdges } from "@/hooks/use-scroll-edges";
import { formatClockTime, formatEventDay, formatEventTime } from "@/lib/date";
import { LIST_PAGE_SIZE } from "@/lib/paging";
import { cn } from "@/lib/utils";

/**
 * Events: the project's events, newest first, on the shared resource table
 * (D17, D30, D38). An event is what the server recorded of a sign-in step,
 * a change to a record or an API request (`GET /events`), and the screen, the
 * route, the API and the CLI all call it that.
 *
 * A row leads with when the event happened, as a row of Vercel's Logs does:
 * the day, then the clock time to the millisecond, which tells the events of
 * one request apart. Then its type, what it was about and who caused it. In
 * the API requests view every row is a request, so the row is the request, as
 * in Vercel's Request Logs: its method and operation, its status and how long
 * it took.
 * A failure (a failure type, a request answered with 5xx) is tinted. A row
 * opens the event in a drawer at the list's right (`$eventId`, this route's
 * child), as Vercel's Logs opens a request: the list keeps its rows, its
 * scroll and its pages, and the drawer steps through them. Where the two fit
 * side by side the list ends where the drawer starts (D46).
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
 * What belongs together reads together (D45), as Vercel groups by what its
 * server knows rather than by the rows a page holds. The **Sign-ins** view
 * lists one row per sign-in, read as the event it ended in: how it ended,
 * whose account, its session. In the other views the rows stay one per event;
 * while one is open, the loaded rows of its login flow (or else its request)
 * are marked, and the drawer tells the whole flow. An authentication attempt
 * whose flow never finished reads Abandoned. Users are named, not IDs.
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
  loader: async ({ deps }) => {
    const createdAfter = rangeStart(deps.since, new Date());
    const page = await listProjectEvents(requireProjectScope(deps.project), deps, {
      createdAfter,
    });
    // The filters and the range's start the page answers: `Load more`
    // continues these, not the ones a newer navigation is on its way to. When
    // it was read: an attempt is abandoned by its age then.
    return { ...page, search: deps, createdAfter, loadedAt: Date.now() };
  },
  component: EventsScreen,
});

/** The empty table's sentence, by what was asked for. */
const NOTHING: Record<EventView, string> = {
  audit: NO_AUDIT_EVENTS,
  signins: "This project has no sign-ins.",
  requests: "This project has no API requests.",
  all: "This project has no events.",
};

/** Above the button, while a page came back short of its size with more behind it. */
const NOT_ALL_READ = "Not every event has been read yet for these filters.";

function EventsScreen() {
  const projectId = useRequiredProjectScope();
  const loaded = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const navigate = useNavigate();
  const { eventId } = useParams({ strict: false });
  const { session } = useRouteContext({ from: "/_authed" });
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
  const added = useMemo(() => new Set(live.events.map((event) => event.id)), [live.events]);
  const names = useUserNames(events);
  // The open event's login flow, or its request, among the rows: marked, so
  // what belongs together reads together while the drawer tells it.
  const open = events.find((event) => event.id === eventId);
  const together = useMemo(() => belongingWith(events, open), [events, open]);
  // An attempt is abandoned by its age when the rows were last read up to
  // now: the load, or Live's latest read, which brought whatever came after.
  const asOf = live.on && live.checkedAt ? live.checkedAt.getTime() : loaded.loadedAt;
  const abandoned = useMemo(
    () => abandonedAttempts(events, loaded.search, new Date(asOf)),
    [events, loaded.search, asOf],
  );
  const signins = loaded.search.view === "signins";
  const requests = loaded.search.view === "requests";
  // A page short of its size that still has a token: the server stopped at
  // its bound, not at the end of the events (root ADR 048).
  const newestRows = newest.of === loaded ? newest.rows : loaded.items.length;
  const stoppedShort = paging.hasMore && newestRows < LIST_PAGE_SIZE;

  const scroll = useScrollEdges();

  async function refresh() {
    setRefreshing(true);
    try {
      await router.invalidate();
    } finally {
      setRefreshing(false);
    }
  }

  const eventOpen = eventId !== undefined;
  const unmatched = olderUnmatched(loaded.search);

  return (
    <EventRowsContext.Provider value={{ rows: events, search }}>
      {/* Beside the drawer where both fit, not under it. */}
      <Page besideSheet={eventOpen}>
        <ResourceTitle
          filterBelow
          filter={
            <>
              <SidebarFilters search={search} />
              <EventSearchField
                current={search}
                me={session.user_id || undefined}
                besideEvent={eventOpen}
              />
            </>
          }
          action={
            <div className="flex items-center gap-2">
              {canGoLive && (
                <Button
                  variant="secondary"
                  className="shrink-0 gap-2 px-3!"
                  aria-pressed={live.on}
                  onClick={live.toggle}
                >
                  <LiveDot on={live.on} />
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
          Events
        </ResourceTitle>

        <FormError message={live.error} className="mt-3" />
        {live.on && <LiveStatus checkedAt={live.checkedAt} />}

        <div
          ref={scroll.ref}
          data-scroll-end={scroll.edges.end || undefined}
          // One line a row, read by the screenful: the compact rows.
          className={`${RESOURCE_TABLE_WRAP} ${RESOURCE_TABLE_TOP} ${RESOURCE_TABLE_SCROLL} ${RESOURCE_DENSITY.compact}`}
        >
          {/* An event type runs to thirty characters, and the time must show
              its milliseconds, which tell the events of one request apart.
              The table keeps the width both need and scrolls in its card
              below it. */}
          <Table className={cn(RESOURCE_TABLE_FIXED, "min-w-[60rem]")}>
            <TableHeader>
              <ResourceHeaderRow>
                {/* First, as a log leads with its time (Vercel's Logs): the
                    column that stays in view beside an open event, and when
                    the card scrolls. */}
                <ResourceHeadCell className={TIME_COLUMN}>Time</ResourceHeadCell>
                {/* In each view one column has no width: it takes what the
                    others and the menu column leave. */}
                {signins ? (
                  <>
                    <ResourceHeadCell className="w-[17%]">Outcome</ResourceHeadCell>
                    <ResourceHeadCell>User</ResourceHeadCell>
                    <ResourceHeadCell className="w-[22%]">Session</ResourceHeadCell>
                  </>
                ) : requests ? (
                  <>
                    <ResourceHeadCell>Request</ResourceHeadCell>
                    <ResourceHeadCell className="w-[11%]">Status</ResourceHeadCell>
                    <ResourceHeadCell className="w-[13%]">Duration</ResourceHeadCell>
                    <ResourceHeadCell className="w-[20%]">Actor</ResourceHeadCell>
                  </>
                ) : (
                  <>
                    <ResourceHeadCell className="w-[28%]">Event</ResourceHeadCell>
                    <ResourceHeadCell>Details</ResourceHeadCell>
                    <ResourceHeadCell className="w-[17%]">Actor</ResourceHeadCell>
                  </>
                )}
                {/* Pinned, as on Users: the table scrolls in its card, and the menu
                    stays in reach. */}
                <ResourceMenuHead narrow className={RESOURCE_STICKY_END} />
              </ResourceHeaderRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 ? (
                <ResourceEmptyRow colSpan={requests ? 6 : 5}>
                  {/* Nothing yet is not nothing: more events are still unread. */}
                  {stoppedShort
                    ? "No events have matched so far."
                    : isNarrowed(loaded.search)
                      ? "No events match these filters."
                      : NOTHING[loaded.search.view]}
                  {/* An event that offered the filter may be one it cannot match. */}
                  {unmatched && <span className="mt-1 block text-xs">{unmatched}</span>}
                </ResourceEmptyRow>
              ) : (
                events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    search={search}
                    selected={event.id === eventId}
                    added={added.has(event.id)}
                    names={names}
                    signins={signins}
                    requests={requests}
                    together={together.ids.has(event.id) ? together.by : undefined}
                    grouped={event.id === eventId && together.ids.size > 0}
                    abandoned={abandoned.has(event.id)}
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

      <EventSheet open={eventOpen} onClose={() => void navigate({ to: "/events", search })}>
        <Outlet />
      </EventSheet>
    </EventRowsContext.Provider>
  );
}

/**
 * The Time column: a day, a clock time to the millisecond in a twelve-hour
 * locale, and the cell's inset. A day older than eleven months carries its
 * year and fits too.
 */
const TIME_COLUMN = "w-62";

/**
 * A row's time, which leads it as in Vercel's Logs: the day, stepped back,
 * then the clock time to the millisecond, which is what tells the rows of one
 * screen apart. The whole moment, year included, is the cell's title and the
 * drawer's.
 */
function RowTime({ at }: { at: string }) {
  // What arrived, once, when it is no moment.
  if (Number.isNaN(Date.parse(at))) return <span className="truncate text-sm">{at}</span>;
  return (
    <time
      dateTime={at}
      title={formatEventTime(at)}
      className="flex min-w-0 items-baseline gap-1.5 text-sm whitespace-nowrap tabular-nums"
    >
      <span className="text-muted-foreground shrink-0">{formatEventDay(at)}</span>
      <span className="text-foreground truncate">{formatClockTime(at)}</span>
    </time>
  );
}

/** A failed row's tint, opaque: the pinned menu cell covers the columns scrolled under it. */
const FAILURE_STICKY =
  "transition-colors bg-[color-mix(in_oklab,var(--color-destructive)_5%,var(--color-card))] group-hover:bg-[color-mix(in_oklab,var(--color-destructive)_10%,var(--color-card))]";

/**
 * One event. The whole row opens it in the drawer; its menu narrows the list
 * by what it carries, or reads the minutes around it.
 */
function EventRow({
  event,
  search,
  selected,
  added,
  names,
  signins,
  requests,
  together,
  grouped,
  abandoned,
}: {
  event: ProjectEvent;
  search: EventsSearch;
  /** Open in the drawer. */
  selected: boolean;
  /** Read by Live after the list loaded: it fades in. */
  added: boolean;
  /** What the users the rows name are called. */
  names: ReadonlyMap<string, string>;
  /** Drawn as a sign-in: how it ended, whose account, which session. */
  signins: boolean;
  /** Drawn as an API request: its method and operation, its status and how long it took. */
  requests: boolean;
  /** Of the open event's login flow or request: marked, and named for a screen reader. */
  together?: "login flow" | "request";
  /** Open, with other rows of its flow or request loaded: it heads their rail. */
  grouped: boolean;
  /** An authentication attempt whose flow never finished: marked so. */
  abandoned: boolean;
}) {
  const navigate = useNavigate();
  const params = { eventId: event.id };
  const signin = signins ? signinOf(event) : undefined;
  const subject = eventSubject(event);
  const request = requests && subject?.kind === "request" ? subject : undefined;
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
        // For the pinned menu cell's hover.
        "group",
        failure && "bg-destructive/5 hover:bg-destructive/10",
        together && !selected && "bg-muted/60",
        selected && "bg-muted hover:bg-muted",
        added && "animate-in fade-in-0 duration-700 motion-reduce:animate-none",
      )}
    >
      <TableCell
        className={cn(
          RESOURCE_CELL,
          // A rail down the rows that belong with the open one.
          (together || grouped) && "shadow-[inset_3px_0_0_var(--color-primary)]",
        )}
      >
        <RowTime at={event.occurred_at} />
      </TableCell>
      <TableCell className={RESOURCE_CELL}>
        <span className="flex min-w-0 items-center gap-2">
          <Link
            to="/events/$eventId"
            params={params}
            search={search}
            className={`${RESOURCE_ROW_LINK} min-w-0`}
          >
            {signin ? (
              <OutcomeBadge outcome={signin.outcome} />
            ) : request ? (
              // The method steps back, as in Vercel's request rows: the
              // operation is what tells the rows apart.
              <span
                className={cn("truncate", failure && "text-destructive")}
                title={`${request.method} ${request.route}`}
              >
                <span className="text-muted-foreground font-normal">{request.method}</span>{" "}
                {request.route}
              </span>
            ) : (
              <span
                className={cn("truncate", failure && "text-destructive")}
                title={event.event_type}
              >
                {event.event_type}
              </span>
            )}
          </Link>
          {abandoned && (
            <Badge
              variant="outline"
              title="Its login flow never finished before the attempt expired"
            >
              Abandoned
            </Badge>
          )}
          {together && <span className="sr-only">Of the open event’s {together}</span>}
        </span>
      </TableCell>
      {signin ? (
        <>
          <TableCell className={RESOURCE_CELL}>
            <span className="flex min-w-0 items-center gap-2 text-sm">
              {signin.userId ? (
                <UserName id={signin.userId} names={names} />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
              {signin.failure && (
                <span className="text-muted-foreground shrink-0">{signin.failure}</span>
              )}
            </span>
          </TableCell>
          <TableCell className={RESOURCE_CELL}>
            {event.session_id ? (
              <IdText id={event.session_id} title={event.session_id} className="text-sm" />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </TableCell>
        </>
      ) : request ? (
        <>
          <TableCell className={cn(RESOURCE_CELL, "text-sm tabular-nums")}>
            <RequestStatus status={request.status} />
          </TableCell>
          <TableCell className={cn(RESOURCE_CELL_MUTED, "tabular-nums")}>
            {event.event_type === "request.api" ? formatSpan(event.payload.duration_ms) : "—"}
          </TableCell>
          <TableCell className={RESOURCE_CELL}>
            <ActorName actorId={event.actor_id} actorType={event.actor_type} names={names} />
          </TableCell>
        </>
      ) : (
        <>
          <TableCell className={RESOURCE_CELL}>
            <EventSubject event={event} />
          </TableCell>
          <TableCell className={RESOURCE_CELL}>
            <ActorName actorId={event.actor_id} actorType={event.actor_type} names={names} />
          </TableCell>
          {/* Only in the requests' own columns, should another event reach them. */}
          {requests && <TableCell className={RESOURCE_CELL} />}
        </>
      )}
      <TableCell
        className={cn(
          RESOURCE_MENU_CELL_NARROW,
          "text-right",
          RESOURCE_STICKY_END,
          // The pinned cell paints its own fill, so it takes the row's.
          selected ? "bg-muted" : failure ? FAILURE_STICKY : RESOURCE_STICKY_BODY,
        )}
      >
        <RowMenu name={`${event.event_type}, ${event.id}`} size="icon-xs" contentClassName="w-56">
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
