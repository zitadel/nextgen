import { createFileRoute, useParams } from "@tanstack/react-router";

import type { EventLinks } from "@/features/events/components/event-panel";
import { EventsScreen } from "@/features/events/components/events-screen";
import { loadEvents } from "@/features/events/load";
import type { EventsSearch } from "@/features/events/model";
import { requirePlatformRoot } from "@/features/platform/access";
import { ManagedProject } from "@/features/projects/project-scope";

/**
 * Audit log at the root: the deployment's audit trail, the reserved
 * platform project's Audit events (D41, the default view of D30), newest
 * first: the sign-ins and changes to the console's accounts and
 * configuration. Drawn by the project's Events list with the platform
 * project's id; a row of the root sidebar for someone who may act on that
 * project, and the selected project stays in the URL (D36).
 *
 * The sidebar stays the root's list, so there is no view picker and no
 * filter here: the table and its pages alone, `Load more` or, for a page cut
 * short, `Keep looking`. An event opens in the drawer over the list
 * (`$eventId`, this route's child), which never reads the list again, and
 * nothing on the page leads into a project's Events.
 */
export const Route = createFileRoute("/_authed/platform/audit-log")({
  // On the layout, so the list and an event's drawer are both root pages.
  staticData: { platformRoot: true },
  beforeLoad: requirePlatformRoot,
  loader: ({ context }) => loadEvents(context.platformProjectId, AUDIT_LOG),
  component: PlatformAuditLog,
});

/** The one view the page reads: the audit events, everything retained. */
const AUDIT_LOG: EventsSearch = { view: "audit" };

/**
 * The page's own routes: the drawer over it and its close. No `filtered`, so
 * neither a row nor the drawer offers a filter, and none of its links names a
 * project (`_authed` keeps the selection).
 */
const LINKS: EventLinks = {
  event: (eventId) => ({ to: "/platform/audit-log/$eventId", params: { eventId } }),
  list: { to: "/platform/audit-log" },
};

function PlatformAuditLog() {
  const { platformProjectId } = Route.useRouteContext();
  const { eventId } = useParams({ strict: false });
  return (
    <ManagedProject id={platformProjectId}>
      <EventsScreen
        title="Audit log"
        projectId={platformProjectId}
        loaded={Route.useLoaderData()}
        search={AUDIT_LOG}
        eventId={eventId}
        links={LINKS}
        nothing="There are no audit events yet."
      />
    </ManagedProject>
  );
}
