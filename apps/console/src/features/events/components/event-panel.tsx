import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect } from "react";

import { DocumentViewer } from "@/components/document-viewer";
import { FormSheetHeader } from "@/components/form-sheet";
import { SECTION_HEADING } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Sheet, SheetContent, SheetDescription } from "@/components/ui/sheet";
import { formatClockTime, formatLogTime } from "@/lib/date";
import { cn } from "@/lib/utils";

import type { EventTimeline } from "../api";
import {
  around,
  eventFields,
  eventFilterValues,
  isFailure,
  type LogEvent,
  type LogsSearch,
  sharing,
} from "../model";
import { EventSubject } from "./event-subject";

/**
 * The rows the Logs list draws, in its order, and the filters it is under:
 * what the event panel steps through and keeps when it opens another event.
 * The list provides it; the panel beside it reads it.
 */
export const LogRowsContext = createContext<{ rows: LogEvent[]; search: LogsSearch }>({
  rows: [],
  search: { view: "audit" },
});

/**
 * The drawer an event opens in, over the right of the Logs list, as Vercel's
 * Logs opens a request: the list stays where it was, scrolled and paged, and
 * a click on another row opens that one in the same drawer. So it is not
 * modal, no overlay dims the list, and a click outside it does not close it;
 * the close button and Escape do.
 *
 * It stays mounted while one event gives way to the next, so stepping through
 * the list does not slide it in again.
 */
export function EventSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} modal={false}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-130"
        // The list stays usable beside it.
        onInteractOutside={(event) => event.preventDefault()}
        // Focus stays on the row that opened it, so the arrow keys step on.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {children}
      </SheetContent>
    </Sheet>
  );
}

/** The drawer while its event loads, or when it cannot: a sentence under a bare header. */
export function EventPanelMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <FormSheetHeader title={title} />
      <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">{children}</div>
    </>
  );
}

/** The drawer while its event loads. */
export function EventPanelPending() {
  return (
    <EventPanelMessage title="Event">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span role="status">Loading…</span>
    </EventPanelMessage>
  );
}

/** Whether a key press belongs to a field, where the arrow keys move the caret. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest("input, textarea, select, [role=listbox], [role=menu]") !== null
  );
}

/**
 * One event in the drawer: its type over its time and id, then what it was
 * about, the events it belongs with in the order they happened (its login
 * flow's, or else its request's), the values its envelope carries, where it
 * leads on to, and the event as the API returns it.
 *
 * The arrows in its header, and ↑ and ↓ (or k and j) anywhere but a field,
 * open the previous and next row of the list. At the last row loaded they
 * stop: `Load more` is the list's.
 */
export function EventPanel({
  event,
  request,
  flow,
}: {
  event: LogEvent;
  /** Its request's events, oldest first, when it was made by one. */
  request?: EventTimeline;
  /** Its login flow's events, oldest first, when it is part of one; drawn in place of the request's. */
  flow?: EventTimeline;
}) {
  const { rows, search } = useContext(LogRowsContext);
  const navigate = useNavigate();
  const index = rows.findIndex((row) => row.id === event.id);
  const previous = index > 0 ? rows[index - 1] : undefined;
  const next = index >= 0 && index < rows.length - 1 ? rows[index + 1] : undefined;

  const open = (target: LogEvent | undefined) => {
    if (!target) return;
    void navigate({ to: "/events/$eventId", params: { eventId: target.id }, search });
  };

  useEffect(() => {
    function onKey(keyEvent: KeyboardEvent) {
      if (keyEvent.altKey || keyEvent.ctrlKey || keyEvent.metaKey || typing(keyEvent.target)) {
        return;
      }
      const step =
        keyEvent.key === "ArrowUp" || keyEvent.key === "k"
          ? previous
          : keyEvent.key === "ArrowDown" || keyEvent.key === "j"
            ? next
            : undefined;
      if (!step) return;
      keyEvent.preventDefault();
      void navigate({ to: "/events/$eventId", params: { eventId: step.id }, search });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [previous, next, navigate, search]);

  const fields = eventFields(event);
  const related = eventFilterValues(event);

  return (
    <>
      <FormSheetHeader
        title={event.event_type}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous event"
              disabled={!previous}
              onClick={() => open(previous)}
            >
              <ChevronUp aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next event"
              disabled={!next}
              onClick={() => open(next)}
            >
              <ChevronDown aria-hidden />
            </Button>
          </>
        }
      />
      <SheetDescription className="sr-only">
        The event {event.id}, recorded {formatLogTime(event.occurred_at)}.
      </SheetDescription>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
        <dl className={FIELD_GRID}>
          <dt className={FIELD_LABEL}>Event ID</dt>
          <dd className={FIELD_VALUE}>
            <span className="min-w-0 break-all">{event.id}</span>
            <CopyButton value={event.id} label="Copy Event ID" size="inline" />
          </dd>
          <dt className={FIELD_LABEL}>Occurred</dt>
          <dd className={FIELD_VALUE}>
            <time dateTime={event.occurred_at}>{formatLogTime(event.occurred_at)}</time>
          </dd>
          <dt className={FIELD_LABEL}>About</dt>
          <dd className={FIELD_VALUE}>
            <EventSubject event={event} />
            {event.event_type === "request.api" && (
              <span className="text-muted-foreground shrink-0">{event.payload.duration_ms} ms</span>
            )}
          </dd>
        </dl>

        {flow && flow.items.length > 0 && event.flow_id ? (
          <Timeline
            title="This login flow"
            timeline={flow}
            current={event.id}
            all={{
              search: sharing("flow", event.flow_id),
              label: "List all of this login flow’s events",
            }}
          />
        ) : (
          request &&
          request.items.length > 0 && (
            <Timeline
              title="This request"
              timeline={request}
              current={event.id}
              all={
                event.request_id
                  ? {
                      search: sharing("request", event.request_id),
                      label: "List all of this request’s events",
                    }
                  : undefined
              }
            />
          )
        )}

        {fields.length > 0 && (
          <PanelSection title="Details">
            <dl className={FIELD_GRID}>
              {fields.map((field) => (
                <FieldRow key={field.label} label={field.label} value={field.value} id={field.id} />
              ))}
            </dl>
          </PanelSection>
        )}

        <PanelSection title="Related events">
          <ul className="flex flex-wrap gap-2">
            {related.map(({ filter, value }) => (
              <li key={filter.key}>
                <Button asChild variant="outline" size="sm">
                  <Link to="/events" search={sharing(filter.key, value)}>
                    Same {filter.name}
                  </Link>
                </Button>
              </li>
            ))}
            <li>
              <Button asChild variant="outline" size="sm">
                <Link to="/events" search={around(event)}>
                  Around this time
                </Link>
              </Button>
            </li>
          </ul>
        </PanelSection>

        <PanelSection title="Document">
          <DocumentViewer document={event} noun="event" cliHint={false} />
        </PanelSection>
      </div>
    </>
  );
}

/** Label beside value: a 112px rail, then the value, at the drawer's width. */
const FIELD_GRID = "grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm leading-5";
const FIELD_LABEL = "text-muted-foreground";
const FIELD_VALUE = "text-foreground flex min-w-0 items-center gap-1.5";

/** One envelope value; an id wraps rather than widens the drawer, and copies. */
function FieldRow({ label, value, id }: { label: string; value: string; id?: boolean }) {
  return (
    <>
      <dt className={FIELD_LABEL}>{label}</dt>
      <dd className={FIELD_VALUE}>
        <span className="min-w-0 break-all">{value}</span>
        {id && <CopyButton value={value} label={`Copy ${label}`} size="inline" />}
      </dd>
    </>
  );
}

/** A titled part of the drawer's body. */
function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className={SECTION_HEADING}>{title}</h3>
      {children}
    </section>
  );
}

/**
 * The events the open one belongs with, oldest first, and a way to the rest
 * when the drawer does not hold them all.
 */
function Timeline({
  title,
  timeline,
  current,
  all,
}: {
  title: string;
  timeline: EventTimeline;
  /** The open event's id. */
  current: string;
  /** The list under the filter that holds them all. */
  all?: { search: LogsSearch; label: string };
}) {
  return (
    <PanelSection title={title}>
      <ol className="flex flex-col">
        {timeline.items.map((step) => (
          <TimelineStep key={step.id} event={step} current={step.id === current} />
        ))}
      </ol>
      {timeline.more && all && (
        <Link to="/events" search={all.search} className="text-sm underline underline-offset-4">
          {all.label}
        </Link>
      )}
    </PanelSection>
  );
}

/**
 * One event of a timeline, as a line of it: when, to the millisecond, what,
 * and what it was about. The open event is marked and not a link; the others
 * open in the drawer.
 */
function TimelineStep({ event, current }: { event: LogEvent; current: boolean }) {
  const { search } = useContext(LogRowsContext);
  const line = (
    <>
      <time dateTime={event.occurred_at} className="text-muted-foreground shrink-0 tabular-nums">
        {formatClockTime(event.occurred_at)}
      </time>
      <span className={cn("shrink-0", isFailure(event) && "text-destructive")}>
        {event.event_type}
      </span>
      <span className="flex min-w-0 flex-1">
        <EventSubject event={event} />
      </span>
    </>
  );
  const row = "flex min-w-0 items-center gap-3 rounded-sm px-2 py-1.5 text-sm";
  return (
    <li>
      {current ? (
        <div className={cn(row, "bg-muted")} aria-current="true">
          {line}
        </div>
      ) : (
        <Link
          to="/events/$eventId"
          params={{ eventId: event.id }}
          search={search}
          className={cn(row, "hover:bg-muted/60")}
        >
          {line}
        </Link>
      )}
    </li>
  );
}
