import { IdText } from "@/components/id-text";
import { cn } from "@/lib/utils";

import { eventSubject, type ProjectEvent } from "@/features/events/model";

/**
 * What the event was about: an API request as its method, operation and
 * status, any other event as the record it touched. Events' rows and the
 * Overview's recent activity draw it alike.
 */
export function EventSubject({ event }: { event: ProjectEvent }) {
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
