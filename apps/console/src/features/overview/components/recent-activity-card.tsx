import { Link } from "@tanstack/react-router";

import { CARD_ACTION_BUTTON, DetailSection } from "@/components/detail-page";
import { Button } from "@/components/ui/button";
import { EventSubject } from "@/features/events/components/event-subject";
import { type LogEvent, NO_AUDIT_EVENTS } from "@/features/events/model";
import type { CardRead } from "@/features/overview/api";
import { formatRecent } from "@/lib/date";

/**
 * The project's newest audit events, the sign-ins and changes Logs lists
 * first: each its type, what it was about and when, opening the event. The
 * card's action is Logs, where the rest are. A project that is not claimed yet
 * reads none, except to a platform operator: its events stay hidden until the
 * claim.
 */
export function RecentActivityCard({ activity }: { activity: CardRead<LogEvent[]> }) {
  return (
    <DetailSection
      title="Recent activity"
      titleId="overview-activity"
      role="region"
      aria-labelledby="overview-activity"
      action={
        <Button asChild variant="secondary" size="sm" className={CARD_ACTION_BUTTON}>
          <Link to="/events" search={{ view: "audit" }}>
            Logs
          </Link>
        </Button>
      }
    >
      {activity.error !== undefined ? (
        <p className="text-sm leading-5 text-muted-foreground">{activity.error}</p>
      ) : activity.value.length === 0 ? (
        // Logs' own sentence for its empty audit view, which this card heads.
        <p className="text-sm leading-5 text-muted-foreground">{NO_AUDIT_EVENTS}</p>
      ) : (
        <ul className="-my-1 flex flex-col divide-y divide-border">
          {activity.value.map((event) => (
            <ActivityRow key={event.id} event={event} />
          ))}
        </ul>
      )}
    </DetailSection>
  );
}

function ActivityRow({ event }: { event: LogEvent }) {
  return (
    <li className="flex min-w-0 flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:gap-6">
      <Link
        to="/events/$eventId"
        params={{ eventId: event.id }}
        // Opened over the audit view, which this card heads.
        search={{ view: "audit" }}
        className="min-w-0 truncate text-sm font-medium text-foreground hover:underline sm:w-64 sm:shrink-0"
        title={event.event_type}
      >
        {event.event_type}
      </Link>
      <span className="flex min-w-0 flex-1">
        <EventSubject event={event} />
      </span>
      <time dateTime={event.occurred_at} className="shrink-0 text-sm text-muted-foreground">
        {formatRecent(event.occurred_at)}
      </time>
    </li>
  );
}
