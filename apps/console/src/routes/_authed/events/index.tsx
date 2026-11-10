import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ListFilter, Logs, RefreshCw } from "lucide-react";
import { useState } from "react";
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
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { listProjectEvents } from "@/features/events/api";
import { EventSearch } from "@/features/events/components/event-search";
import {
  eventFilterValues,
  eventSubject,
  filterCount,
  isNarrowed,
  type LogEvent,
  type LogsSearch,
  type LogView,
  narrowedBy,
  parseLogsSearch,
  rangeStart,
  VIEW_LABEL,
} from "@/features/events/model";
import { requireProjectScope, useRequiredProjectScope } from "@/features/projects/project-scope";
import { useLoadMore } from "@/hooks/use-load-more";
import { formatTimestamp } from "@/lib/date";
import { cn } from "@/lib/utils";

/**
 * Logs: the project's events, newest first, on the shared resource table
 * (D17, D30). An event is what the server recorded of a sign-in step, a
 * change to a record or an API request (`GET /events`); the API and the CLI
 * call them events, and the route keeps that name.
 *
 * A row names the event's type, what it was about, who caused it and when it
 * happened, to the second. A row opens the event.
 *
 * Which events are listed is chosen in the sidebar, whose list Logs replaces
 * with its own (`LogViewRows`, `LogFilters`): the view (audit events, the
 * default; API requests; both), then the filters. They live in the URL: they
 * are server-side, so they belong to the request the loader makes. Every one
 * is served by an index on the server, and `parseLogsSearch` gives way where
 * two would not combine, so no URL reads further than the page it shows.
 *
 * The search above the table takes one id or one event type and sets the
 * filter it names (`EventSearch`). A row's menu narrows the list by a value
 * the row carries. While the sidebar is an icon rail, on a phone or collapsed,
 * a button beside the search names the view and opens it.
 *
 * The list is a snapshot of the moment it loaded: **Refresh** reads it again
 * from the newest event. The time range is counted back from that moment, and
 * `Load more` keeps it, so a page never slides past rows the range dropped.
 */
export const Route = createFileRoute("/_authed/events/")({
  // After Authentication, before Settings: the last of the project's
  // contents, and what the screens above it did.
  staticData: { scope: "project", nav: { label: "Logs", order: 9, icon: Logs } },
  validateSearch: parseLogsSearch,
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

function LogsScreen() {
  const projectId = useRequiredProjectScope();
  const loaded = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const paging = useLoadMore(
    loaded,
    (pageToken) =>
      listProjectEvents(projectId, loaded.search, {
        createdAfter: loaded.createdAfter,
        pageToken,
      }),
    "Could not load more events.",
  );
  const events = [...loaded.items, ...paging.extra];

  async function refresh() {
    setRefreshing(true);
    try {
      await router.invalidate();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Page>
      <ResourceTitle
        filter={
          <>
            <SidebarFilters search={search} />
            <EventSearch current={search} />
          </>
        }
        action={
          // `px-2.5!`: `Button`'s `has-[>svg]:px-3` out-specifies a plain
          // `px-2.5`.
          <Button
            variant="secondary"
            className="shrink-0 gap-1.5 px-2.5!"
            onClick={() => void refresh()}
            loading={refreshing}
          >
            <RefreshCw aria-hidden />
            Refresh
          </Button>
        }
      >
        Logs
      </ResourceTitle>

      <div className={`${RESOURCE_TABLE_WRAP} ${RESOURCE_TABLE_TOP}`}>
        {/* An event type runs to thirty characters, and the time must show
            its seconds, which tell the events of one request apart. The
            table keeps the width both need and scrolls in its card below
            it; a quarter of that width is a timestamp with its inset. */}
        <Table className={cn(RESOURCE_TABLE_FIXED, "min-w-[58rem]")}>
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell className="w-[26%]">Event</ResourceHeadCell>
              <ResourceHeadCell className="w-[28%]">Details</ResourceHeadCell>
              <ResourceHeadCell className="w-[16%]">Actor</ResourceHeadCell>
              <ResourceHeadCell className="w-[24%]">Time</ResourceHeadCell>
              <ResourceMenuHead className="w-[6%] px-2" />
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {events.length === 0 ? (
              <ResourceEmptyRow colSpan={5}>
                {isNarrowed(loaded.search)
                  ? "No events match these filters."
                  : NOTHING[loaded.search.view]}
              </ResourceEmptyRow>
            ) : (
              events.map((event) => <EventRow key={event.id} event={event} search={search} />)
            )}
          </TableBody>
        </Table>
      </div>

      <LoadMore paging={paging} />
    </Page>
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

/** One event. The whole row opens it; its menu narrows the list by what it carries. */
function EventRow({ event, search }: { event: LogEvent; search: LogsSearch }) {
  const navigate = useNavigate();
  const params = { eventId: event.id };
  // A system actor has no id: its kind is all there is to name.
  const actor = event.actor_id || event.actor_type;
  // A value the list is narrowed to already would narrow it no further.
  const narrowings = eventFilterValues(event).filter(
    ({ filter, value }) => search[filter.key] !== value,
  );

  return (
    <ResourceRow onOpen={() => void navigate({ to: "/events/$eventId", params })}>
      <TableCell className={RESOURCE_CELL}>
        <Link to="/events/$eventId" params={params} className={`${RESOURCE_ROW_LINK} max-w-full`}>
          <Logs aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
          <span className="truncate" title={event.event_type}>
            {event.event_type}
          </span>
        </Link>
      </TableCell>
      <TableCell className={RESOURCE_CELL}>
        <Subject event={event} />
      </TableCell>
      <TableCell className={RESOURCE_CELL}>
        {actor ? (
          <IdText id={actor} title={actor} className="text-foreground text-sm" />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>
        <time dateTime={event.occurred_at}>{formatTimestamp(event.occurred_at)}</time>
      </TableCell>
      {/* 8px inset, not the cells' 24px: the column is the menu's button and
          no wider. */}
      <TableCell className="h-14 px-2 py-2 text-right">
        <RowMenu name={`${event.event_type}, ${event.id}`} contentClassName="w-52">
          <DropdownMenuItem asChild>
            <Link to="/events/$eventId" params={params}>
              View event
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

/**
 * What the event was about: an API request as its method, operation and
 * status, any other event as the record it touched.
 */
function Subject({ event }: { event: LogEvent }) {
  const subject = eventSubject(event);
  if (!subject) return <span className="text-muted-foreground">—</span>;

  if (subject.kind === "request") {
    return (
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <span className="text-foreground truncate">
          {subject.method} {subject.route}
        </span>
        {/* The number says it; the colour only draws the eye to a failure. */}
        <span
          className={cn(
            "shrink-0",
            subject.status >= 500
              ? "text-destructive"
              : subject.status >= 400
                ? "text-warning"
                : "text-muted-foreground",
          )}
        >
          {subject.status}
        </span>
      </span>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-2 text-sm">
      {/* The API's own value, its underscores read as spaces. */}
      <span className="text-muted-foreground shrink-0">{subject.type.replace(/_/g, " ")}</span>
      {subject.id && <IdText id={subject.id} title={subject.id} className="text-foreground" />}
    </span>
  );
}
