import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Logs, RefreshCw } from "lucide-react";
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
  ResourceRow,
  ResourceTitle,
} from "@/components/resource-list";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { listProjectEvents } from "@/features/events/api";
import { eventSubject, type LogEvent } from "@/features/events/model";
import {
  projectScopeDeps,
  requireProjectScope,
  useRequiredProjectScope,
} from "@/features/projects/project-scope";
import { useLoadMore } from "@/hooks/use-load-more";
import { formatTimestamp } from "@/lib/date";
import { cn } from "@/lib/utils";

/**
 * Logs: the project's events, newest first, on the shared resource table
 * (D17, D30). An event is what the server recorded of a sign-in step, a change to
 * a record or an API request (`GET /events`); the API and the CLI call them
 * events, and the route keeps that name.
 *
 * A row names the event's type, what it was about, who caused it and when it
 * happened, to the second. A row opens the event. The list has no filters
 * yet, so API requests sit among the changes they made.
 *
 * The list is a snapshot of the moment it loaded: **Refresh** reads it again
 * from the newest event.
 */
export const Route = createFileRoute("/_authed/events/")({
  // After Authentication, before Settings: the last of the project's
  // contents, and what the screens above it did.
  staticData: { scope: "project", nav: { label: "Logs", order: 9, icon: Logs } },
  loaderDeps: projectScopeDeps,
  loader: ({ deps }) => listProjectEvents(requireProjectScope(deps.project)),
  component: LogsScreen,
});

function LogsScreen() {
  const projectId = useRequiredProjectScope();
  const loaded = Route.useLoaderData();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const paging = useLoadMore(
    loaded,
    (pageToken) => listProjectEvents(projectId, pageToken),
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
        <Table className={cn(RESOURCE_TABLE_FIXED, "min-w-[54rem]")}>
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell className="w-[26%]">Event</ResourceHeadCell>
              <ResourceHeadCell className="w-[32%]">Details</ResourceHeadCell>
              <ResourceHeadCell className="w-[16%]">Actor</ResourceHeadCell>
              <ResourceHeadCell className="w-[26%]">Time</ResourceHeadCell>
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {events.length === 0 ? (
              <ResourceEmptyRow colSpan={4}>This project has no events.</ResourceEmptyRow>
            ) : (
              events.map((event) => <EventRow key={event.id} event={event} />)
            )}
          </TableBody>
        </Table>
      </div>

      <LoadMore paging={paging} />
    </Page>
  );
}

/** One event. The whole row opens it. */
function EventRow({ event }: { event: LogEvent }) {
  const navigate = useNavigate();
  const params = { eventId: event.id };
  // A system actor has no id: its kind is all there is to name.
  const actor = event.actor_id || event.actor_type;

  return (
    <ResourceRow onOpen={() => void navigate({ to: "/events/$eventId", params })}>
      <TableCell className={RESOURCE_CELL}>
        <Link to="/events/$eventId" params={params} className={`${RESOURCE_ROW_LINK} max-w-full`}>
          <Logs aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
          <span className="truncate">{event.event_type}</span>
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
    </ResourceRow>
  );
}

/**
 * What the event was about: an API request as its method, route and status,
 * any other event as the record it touched.
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
