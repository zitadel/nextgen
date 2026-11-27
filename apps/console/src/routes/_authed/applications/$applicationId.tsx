import { createFileRoute } from "@tanstack/react-router";
import { AppWindow } from "lucide-react";

import { api } from "@/api/zitadel";
import {
  DETAIL_BODY,
  DETAIL_STACK,
  DetailHeader,
  DetailRow,
  DetailRows,
  DetailSection,
} from "@/components/detail-page";
import { Page } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { ApplicationClients } from "@/features/applications/components/application-clients";
import { applicationSourceLabel } from "@/features/applications/model";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { formatDate } from "@/lib/date";

/**
 * Application detail: where the application is written, then its OAuth
 * clients, each opening to its settings and document.
 *
 * The design's Overview card also holds the issuer URL. The server derives
 * the issuer from the origin a request arrives at, so the API returns no one
 * value for it, and the row is left out until it does (D41).
 *
 * Read-only, and opened by its URL: the API has no applications list yet, so
 * the sidebar has no Applications entry to reach it from.
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
  const { clients } = application.definition;

  return (
    <Page>
      <DetailHeader
        icon={AppWindow}
        // The slug: what flows and other documents call the application, and
        // fixed for its life.
        title={application.slug}
        meta={[
          { label: "Application ID", value: application.id, copyable: true },
          { label: "Created", value: formatDate(application.created_at) },
        ]}
      />

      <div className={`${DETAIL_BODY} ${DETAIL_STACK}`}>
        <DetailSection title="Overview">
          <DetailRows>
            <DetailRow align="center" label="Source">
              <Badge variant="secondary">{applicationSourceLabel(application.declared)}</Badge>
            </DetailRow>
          </DetailRows>
        </DetailSection>

        <DetailSection title="Configuration">
          <ApplicationClients clients={clients} declared={application.declared} />
        </DetailSection>
      </div>
    </Page>
  );
}
