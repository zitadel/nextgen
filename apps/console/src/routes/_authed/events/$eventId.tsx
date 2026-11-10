import { createFileRoute, Link } from "@tanstack/react-router";
import { Logs } from "lucide-react";
import { Fragment } from "react";
import { MetaRule, MetaValue } from "@/components/detail-meta";
import { DETAIL_BODY, DetailHeader, DetailRow, DetailSection } from "@/components/detail-page";
import { DocumentViewer } from "@/components/document-viewer";
import { Page } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Separator } from "@/components/ui/separator";
import { getProjectEvent } from "@/features/events/api";
import { eventFields, eventFilterValues, sharing } from "@/features/events/model";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { formatTimestamp } from "@/lib/date";

/**
 * One event, opened from Logs. The sidebar keeps Logs marked.
 *
 * The header names the event's type, its id and when it happened. Details
 * lists the values its envelope carries: who caused it, through which
 * application, on which record, and the ids that tie it to the other events
 * of the same request, session or login flow. Related events leads on to
 * those: Logs narrowed to everything that shares one of its values, in every
 * view, since a request's own event is not an audit event. Document is the
 * event as the API returns it, which is also what a webhook receives, so it
 * copies whole.
 *
 * An event is read-only: nothing here edits or removes it.
 */
export const Route = createFileRoute("/_authed/events/$eventId")({
  staticData: { scope: "project", resource: "event" },
  loaderDeps: projectScopeDeps,
  loader: ({ params, deps }) => getProjectEvent(requireProjectScope(deps.project), params.eventId),
  component: EventDetail,
});

function EventDetail() {
  const event = Route.useLoaderData();
  const fields = eventFields(event);
  const related = eventFilterValues(event);

  return (
    <Page>
      <DetailHeader
        icon={Logs}
        title={event.event_type}
        meta={
          <>
            <MetaValue label="Event ID" value={event.id} copyable />
            <MetaRule />
            <MetaValue label="Occurred" value={formatTimestamp(event.occurred_at)} />
          </>
        }
      />

      <div className={`${DETAIL_BODY} flex flex-col gap-6`}>
        <DetailSection title="Details">
          <div className="flex flex-col gap-3">
            {fields.map((field, index) => (
              <Fragment key={field.label}>
                {index > 0 && <Separator />}
                <DetailRow label={field.label} align="center">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {/* `break-all`: an id has no break point, and must wrap on
                        a phone rather than widen the card. */}
                    <span className="text-foreground min-w-0 text-sm leading-5 break-all">
                      {field.value}
                    </span>
                    {field.id && (
                      <CopyButton value={field.value} label={`Copy ${field.label}`} size="inline" />
                    )}
                  </span>
                </DetailRow>
              </Fragment>
            ))}
          </div>
        </DetailSection>

        <DetailSection title="Related events">
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
          </ul>
        </DetailSection>

        <DetailSection title="Document">
          <DocumentViewer document={event} noun="event" cliHint={false} />
        </DetailSection>
      </div>
    </Page>
  );
}
