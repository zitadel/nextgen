import { Link, Outlet, useNavigate, useRouter } from "@tanstack/react-router";
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
import { Button } from "@/components/ui/button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { useLoadMore } from "@/hooks/use-load-more";
import { useScrollEdges } from "@/hooks/use-scroll-edges";
import { formatEventTime } from "@/lib/date";
import { LIST_PAGE_SIZE } from "@/lib/paging";
import { cn } from "@/lib/utils";

import { listProjectEvents } from "../api";
import { type EventLinks, type EventsHome, eventLinks } from "../home";
import type { EventsLoad } from "../load";
import {
  around,
  eventFilterValues,
  type EventsSearch,
  type EventView,
  isFailure,
  isNarrowed,
  isNarrowedTo,
  NO_AUDIT_EVENTS,
  narrowedBy,
  type ProjectEvent,
} from "../model";
import { useLiveEvents } from "../use-live-events";
import { EventRowsContext, EventSheet } from "./event-panel";
import { EventSearchField } from "./event-search-field";
import { EventSubject } from "./event-subject";
import { ExportMenu, LiveDot, LiveStatus, SidebarFilters } from "./events-toolbar";

/** The empty table's sentence, by whose events they are and what was asked for. */
const NOTHING: Record<EventsHome, Record<EventView, string>> = {
  "/events": {
    audit: NO_AUDIT_EVENTS,
    requests: "This project has no API requests.",
    all: "This project has no events.",
  },
  "/platform/events": {
    audit: "The platform has no audit events.",
    requests: "The platform has no API requests.",
    all: "The platform has no events.",
  },
};

/** Above the button, while a page came back short of its size with more behind it. */
const NOT_ALL_READ = "Not every event has been read yet for these filters.";

/**
 * A list of a project's events, newest first, on the shared resource table
 * (D17, D30): the selected project's Events, and the root's, the reserved
 * platform project's (D41). `home` says which, and every link stays there.
 *
 * A row names the event's type, what it was about, who caused it and when it
 * happened, to the millisecond, which tells the events of one request apart.
 * A failure (a failure type, a request answered with 5xx) is tinted. A row
 * opens the event in a drawer over the list (the route's child, in the
 * `Outlet`), as Vercel's Logs opens a request: the list keeps its rows, its
 * scroll and its pages, and the drawer steps through them.
 *
 * A page can come back short, or empty, and still have more behind it: the
 * server bounds every read, and a combination of filters no single index
 * holds is matched over a fixed number of events a request. The list then
 * says that not every event was read, and its button reads **Keep looking**.
 *
 * **Refresh** reads the list again from the newest event, **Live** adds what
 * is recorded after it every few seconds (`useLiveEvents`): a green dot marks
 * it on, a line under the toolbar says when it last read, and the rows it
 * adds fade in. **Export** copies or downloads the rows loaded.
 */
export function EventsScreen({
  home,
  projectId,
  loaded,
  search,
  eventId,
  me,
}: {
  /** Where the list lives: a project's Events, or the root's (D41). */
  home: EventsHome;
  /** Whose events: the selected project's, or the platform project's at the root. */
  projectId: string;
  /** The loader's first page, with the filters and the range it answers. */
  loaded: EventsLoad;
  /** The filters the URL holds now, which a row's menu narrows further. */
  search: EventsSearch;
  /** The event open in the drawer, if any. */
  eventId: string | undefined;
  /** The signed-in person, whose activity the search offers. */
  me?: string;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);
  // Every link keeps the list's filters, the drawer's included.
  const links = useMemo(() => eventLinks(home, search), [home, search]);

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

  return (
    <EventRowsContext.Provider value={{ rows: events, links }}>
      <Page>
        <ResourceTitle
          filterBelow
          filter={
            <>
              <SidebarFilters search={search} />
              <EventSearchField home={home} current={search} me={me} />
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
              below it; a quarter of that width is a timestamp with its
              inset. */}
          <Table className={cn(RESOURCE_TABLE_FIXED, "min-w-[60rem]")}>
            <TableHeader>
              <ResourceHeaderRow>
                <ResourceHeadCell className="w-[26%]">Event</ResourceHeadCell>
                <ResourceHeadCell className="w-[27%]">Details</ResourceHeadCell>
                <ResourceHeadCell className="w-[15%]">Actor</ResourceHeadCell>
                {/* No width: Time takes what the others and the menu column leave. */}
                <ResourceHeadCell>Time</ResourceHeadCell>
                {/* Pinned, as on Users: the table scrolls in its card, and the menu
                    stays in reach. */}
                <ResourceMenuHead narrow className={RESOURCE_STICKY_END} />
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
                      : NOTHING[home][loaded.search.view]}
                </ResourceEmptyRow>
              ) : (
                events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    search={search}
                    links={links}
                    selected={event.id === eventId}
                    added={added.has(event.id)}
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

      <EventSheet open={eventId !== undefined} onClose={() => void navigate(links.list)}>
        <Outlet />
      </EventSheet>
    </EventRowsContext.Provider>
  );
}

/** A failed row's tint, opaque: the pinned menu cell covers the columns scrolled under it. */
const FAILURE_STICKY =
  "transition-colors bg-[color-mix(in_oklab,var(--color-destructive)_5%,var(--color-card))] group-hover:bg-[color-mix(in_oklab,var(--color-destructive)_10%,var(--color-card))]";

/**
 * One event. The whole row opens it in the drawer; its menu narrows the list
 * by what the event carries, or reads the minutes around it.
 */
function EventRow({
  event,
  search,
  links,
  selected,
  added,
}: {
  event: ProjectEvent;
  search: EventsSearch;
  links: EventLinks;
  /** Open in the drawer. */
  selected: boolean;
  /** Read by Live after the list loaded: it fades in. */
  added: boolean;
}) {
  const navigate = useNavigate();
  const opens = links.event(event.id);
  const { filtered } = links;
  // A system actor has no id: its kind is all there is to name.
  const actor = event.actor_id || event.actor_type;
  // A value the list is narrowed to already would narrow it no further.
  const narrowings = eventFilterValues(event).filter(
    ({ filter, value }) => !isNarrowedTo(search, filter.key, value),
  );
  const failure = isFailure(event);

  return (
    <ResourceRow
      onOpen={() => void navigate(opens)}
      data-state={selected ? "selected" : undefined}
      aria-selected={selected}
      className={cn(
        // For the pinned menu cell's hover.
        "group",
        failure && "bg-destructive/5 hover:bg-destructive/10",
        selected && "bg-muted hover:bg-muted",
        added && "animate-in fade-in-0 duration-700 motion-reduce:animate-none",
      )}
    >
      <TableCell className={RESOURCE_CELL}>
        <Link {...opens} className={`${RESOURCE_ROW_LINK} max-w-full`}>
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
        <time dateTime={event.occurred_at}>{formatEventTime(event.occurred_at)}</time>
      </TableCell>
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
            <Link {...opens}>View event</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link {...filtered(around(event))}>Events around this one</Link>
          </DropdownMenuItem>
          {narrowings.length > 0 && <DropdownMenuSeparator />}
          {narrowings.map(({ filter, value }) => (
            <DropdownMenuItem key={filter.key} asChild>
              <Link {...filtered(narrowedBy(search, filter.key, value))}>
                Only this {filter.name}
              </Link>
            </DropdownMenuItem>
          ))}
        </RowMenu>
      </TableCell>
    </ResourceRow>
  );
}
