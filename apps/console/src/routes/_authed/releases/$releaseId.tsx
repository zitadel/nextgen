import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Layers3 } from "lucide-react";
import { api } from "@/api/zitadel";
import { MetaRule, MetaValue } from "@/components/detail-meta";
import {
  DETAIL_BODY,
  DETAIL_STACK,
  DetailHeader,
  DetailRows,
  DetailSection,
} from "@/components/detail-page";
import { Page } from "@/components/layout";
import { ReleaseDeployments } from "@/features/deployments/components/release-deployments";
import { ReleaseStatusBadge } from "@/features/deployments/components/release-status-badge";
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
    const release = await api.getRelease(params.releaseId, { project_id: projectId });
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
    <Page>
      <DetailHeader
        icon={Layers3}
        title={release.id}
        status={<ReleaseStatusBadge status={releaseStatus(release)} live={live} />}
        meta={
          <>
            <MetaValue label="Release ID" value={release.id} copyable />
            <MetaRule />
            <MetaValue label="Created" value={formatDate(release.metadata.created_at)} />
          </>
        }
        action={
          // A revoked release can never be served again, so there is nothing
          // to do with it. A new deployment lands in the card below.
          releaseStatus(release) === "active" && (
            <ReleaseActions
              release={release}
              deployments={deployments}
              inUse={live}
              onChanged={() => router.invalidate()}
            />
          )
        }
      />

      <div className={`${DETAIL_BODY} ${DETAIL_STACK}`}>
        <DetailSection title="Release content">
          <DetailRows>
            {groups.map((group) => (
              <PointerGroupSection key={group.kind} group={group} />
            ))}
          </DetailRows>
        </DetailSection>

        <ReleaseDeployments deployments={deployments} />

        <ReleaseMetadata release={release} />
      </div>
    </Page>
  );
}
