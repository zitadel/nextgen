import { createFileRoute } from "@tanstack/react-router";
import { AppWindow } from "lucide-react";

import { api } from "@/api/zitadel";
import {
  DETAIL_BODY,
  DETAIL_STACK,
  DETAIL_VALUE,
  DetailHeader,
  DetailRow,
  DetailRows,
  DetailSection,
} from "@/components/detail-page";
import { Page } from "@/components/layout";
import { ApplicationClients } from "@/features/applications/components/application-clients";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { formatDate, formatDateTime } from "@/lib/date";

/**
 * Application detail: what the application is, then its OAuth clients, each
 * opening to its settings and document.
 *
 * Read-only, and opened by its URL: the API has no applications list yet, so
 * the sidebar has no Applications entry to reach it from.
 *
 * The read needs `getApplication` to accept the console's session, as the
 * other detail reads do; until the API declares that, it answers 401 here.
 */
export const Route = createFileRoute("/_authed/applications/$applicationId")({
  staticData: { scope: "project", resource: "application" },
  loaderDeps: projectScopeDeps,
  loader: ({ params, deps }) =>
    // Scoped to the selected project: an id of another project reads as not
    // found, exactly as an unknown one does.
    api.getApplication(params.applicationId, { project_id: requireProjectScope(deps.project) }),
  component: ApplicationDetail,
});

function ApplicationDetail() {
  const application = Route.useLoaderData();
  const { name, clients } = application.definition;

  return (
    <Page>
      <DetailHeader
        icon={AppWindow}
        // The slug: what flows and other documents call the application, and
        // fixed for its life. Its name is a value of the card below.
        title={application.slug}
        meta={[
          { label: "Application ID", value: application.id, copyable: true },
          { label: "Created", value: formatDate(application.created_at) },
        ]}
      />

      <div className={`${DETAIL_BODY} ${DETAIL_STACK}`}>
        <DetailSection title="Overview">
          <DetailRows>
            <DetailRow label="Name">
              <span className={DETAIL_VALUE}>{name}</span>
            </DetailRow>
            {/* When the newest revision was written. */}
            <DetailRow label="Last modified">
              <span className={DETAIL_VALUE}>{formatDateTime(application.updated_at)}</span>
            </DetailRow>
          </DetailRows>
        </DetailSection>

        <DetailSection title="Configuration">
          <ApplicationClients clients={clients} />
        </DetailSection>
      </div>
    </Page>
  );
}
