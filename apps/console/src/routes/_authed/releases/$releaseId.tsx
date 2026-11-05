import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Layers3 } from "lucide-react";
import { Fragment } from "react";
import { api } from "@/api/zitadel";
import { MetaCard, MetaRule, MetaValue } from "@/components/detail-meta";
import { DetailPanel, PanelTitle } from "@/components/detail-page";
import { Page } from "@/components/layout";
import { ReleaseDeployments } from "@/features/deployments/components/release-deployments";
import { ReleaseStatusBadge } from "@/features/deployments/components/release-status-badge";
import { SECTION_HEADING } from "@/components/typography";
import { Separator } from "@/components/ui/separator";
import { formatDate } from "@/lib/date";
import { listReleaseDeployments } from "@/features/deployments/deployment";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { groupPointers, releaseStatus, resolvePointer } from "@/features/deployments/release";
import {
  PointerGroupSection,
  ReleaseActions,
  ReleaseMetadata,
} from "@/features/deployments/components/release-detail-parts";

/**
 * Release detail: the header, the configuration the release pins, where it
 * went, and its metadata.
 *
 * The header's menu deploys the release, rolls back to it or revokes it; a
 * revoked release has no menu.
 *
 * The pointers fail soft; the release and deployment reads are what the
 * route's error state reports.
 */
export const Route = createFileRoute("/_authed/releases/$releaseId")({
  staticData: { scope: "project" },
  loaderDeps: projectScopeDeps,
  loader: async ({ params, deps }) => {
    const projectId = requireProjectScope(deps.project);
    // Scoped to the selected project: an id of another project reads as not
    // found, exactly as an unknown one does.
    const release = await api.getReleaseById(params.releaseId, { project_id: projectId });
    // Every pointer in parallel: a release pins a handful, and each read
    // fails soft inside `resolvePointer`, so one unreadable revision costs
    // its row's document, not the screen.
    const [pointers, deployments] = await Promise.all([
      Promise.all(release.pointers.map((pointer) => resolvePointer(pointer, projectId))),
      listReleaseDeployments(projectId, release.id),
    ]);
    return { release, groups: groupPointers(pointers), deployments };
  },
  component: ReleaseDetail,
});

function ReleaseDetail() {
  const { release, groups, deployments } = Route.useLoaderData();
  const router = useRouter();
  const live = deployments.some((deployment) => deployment.status === "live");

  return (
    <Page inset="panel">
      <div className="flex flex-col gap-6">
        <DetailPanel>
          {/* One row from `xl`, not `lg` as the other detail headers: a 30-character
              title beside a 30-character id, a date and the menu does not fit in
              the row at 1024px, and a wrapped header reads worse than a stacked one. */}
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            {/* Stacks below `sm`, as the mobile frame puts the pill under the title. */}
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
              <PanelTitle icon={Layers3} title={release.id} />
              <ReleaseStatusBadge status={releaseStatus(release)} live={live} />
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
              <MetaCard bordered={false}>
                <MetaValue label="Release ID" value={release.id} size="sm" copyable />
                <MetaRule />
                <MetaValue
                  label="Created"
                  value={formatDate(release.metadata.created_at)}
                  size="sm"
                />
              </MetaCard>
              {/* A revoked release can never be served again, so there is nothing
                to do with it. A new deployment lands in the card below. */}
              {releaseStatus(release) === "active" && (
                <ReleaseActions
                  release={release}
                  deployments={deployments}
                  inUse={live}
                  onChanged={() => router.invalidate()}
                />
              )}
            </div>
          </div>

          <Separator />

          {/* The section's own heading, ruled off from the groups it heads. */}
          <h2 className={SECTION_HEADING}>Release content</h2>
          <Separator />

          {groups.map((group) => (
            <Fragment key={group.kind}>
              <PointerGroupSection group={group} />
              <Separator />
            </Fragment>
          ))}
        </DetailPanel>

        <ReleaseDeployments deployments={deployments} />

        <ReleaseMetadata release={release} />
      </div>
    </Page>
  );
}
