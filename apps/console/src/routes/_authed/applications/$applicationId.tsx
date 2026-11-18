import { createFileRoute } from "@tanstack/react-router";
import { AppWindow } from "lucide-react";

import { api } from "@/api/zitadel";
import { DETAIL_BODY, DetailHeader, DetailSection } from "@/components/detail-page";
import { Page } from "@/components/layout";
import { ApplicationClients } from "@/features/applications/components/application-clients";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { formatDate } from "@/lib/date";

/**
 * Application detail: its OAuth clients, each opening to its settings and
 * document.
 *
 * The design's Overview card holds the application's source and issuer URL;
 * the API returns neither yet, so the card is left out until it does.
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

      <div className={DETAIL_BODY}>
        <DetailSection title="Configuration">
          <ApplicationClients clients={clients} />
        </DetailSection>
      </div>
    </Page>
  );
}
