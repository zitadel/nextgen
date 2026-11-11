import { createFileRoute } from "@tanstack/react-router";
import { Boxes, LayoutGrid } from "lucide-react";

import { MetaRule, MetaValue } from "@/components/detail-meta";
import { DETAIL_BODY, DetailHeader } from "@/components/detail-page";
import { Page } from "@/components/layout";
import { loadProjectOverview } from "@/features/overview/api";
import { ProductionCard } from "@/features/overview/components/production-card";
import { RecentActivityCard } from "@/features/overview/components/recent-activity-card";
import { primaryHost } from "@/features/projects/model";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { formatDate } from "@/lib/date";

/**
 * Overview: the project's landing, and the first row of its sidebar, where
 * Projects stands above every project (D35). As Vercel's project Overview, it
 * says what the project is and what it is doing, and hands each part over to
 * the screen it summarizes: what the primary origins serve now (Deployments)
 * and the newest audit events (Logs).
 *
 * It holds no figures. An earlier overview design was stat cards (totals and
 * their trends), and nothing can compute them: the API's lists return pages,
 * with no count or aggregate behind them (D5). Every block here is a read a
 * screen already makes, cut short.
 *
 * `/` is where sign-in, `zitadel console`, the logo of a project and the claim
 * flow's "Open the console" land, and where choosing a project goes when no
 * screen was asked for. With no project selected and several to choose from,
 * the `_authed` guard sends `/` to Projects itself rather than by way of
 * "Continue to Overview": arriving at the console asked for no screen (D22).
 */
export const Route = createFileRoute("/_authed/")({
  // First: the project's own page, in the slot Projects holds above it.
  staticData: { scope: "project", nav: { label: "Overview", order: 1, icon: LayoutGrid } },
  loaderDeps: projectScopeDeps,
  loader: ({ deps }) => loadProjectOverview(requireProjectScope(deps.project)),
  component: OverviewScreen,
});

function OverviewScreen() {
  const { project, live, activity } = Route.useLoaderData();

  return (
    <Page>
      <DetailHeader
        icon={Boxes}
        title={project.name}
        // The site the project signs people into, as Projects names it (D21).
        subtitle={primaryHost(project.origins)}
        meta={
          <>
            <MetaValue label="Project ID" value={project.id} copyable />
            <MetaRule />
            <MetaValue label="Created" value={formatDate(project.created_at)} />
          </>
        }
      />

      {/* The page owns the 16px between its cards, as Settings does. */}
      <div className={`${DETAIL_BODY} flex flex-col gap-4`}>
        <ProductionCard live={live} />
        <RecentActivityCard activity={activity} />
      </div>
    </Page>
  );
}
