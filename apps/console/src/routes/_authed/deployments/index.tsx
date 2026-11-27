import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Layers3, Plus } from "lucide-react";
import { DeploySheet } from "@/features/deployments/components/deploy-sheet";
import {
  LoadMore,
  RESOURCE_TABLE_FIXED,
  RESOURCE_TABLE_TOP,
  RESOURCE_TABLE_WRAP,
  ResourceEmptyRow,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceMenuHead,
  ResourceTitle,
} from "@/components/resource-list";
import { Page } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableHeader } from "@/components/ui/table";
import { useLoadMore } from "@/hooks/use-load-more";
import { cn } from "@/lib/utils";
import { listProjectDeployments, livePrimaryDeployment } from "@/features/deployments/deployment";
import {
  projectScopeDeps,
  requireProjectScope,
  useRequiredProjectScope,
} from "@/features/projects/project-scope";
import { DeploymentRowItem } from "@/features/deployments/components/deployment-row";

/**
 * The deployments directory: the project's history, newest first, on the
 * shared resource table (D17). A row names the release it made live, how many
 * origins it went to and of which kind, whether any origin still serves it,
 * and when. A row opens the release.
 *
 * **New deployment** on the title row opens the Deploy release drawer with
 * the release to pick; the row it records appears here once the drawer
 * closes. A primary row's menu redeploys its release or rolls back to it.
 */
export const Route = createFileRoute("/_authed/deployments/")({
  // After Branding, as the design's sidebar places it.
  staticData: { scope: "project", nav: { label: "Deployments", order: 7, icon: Layers3 } },
  loaderDeps: projectScopeDeps,
  // The live primary deployment is read on its own: the newest page is not
  // guaranteed to hold the live primary row once previews outnumber it.
  loader: async ({ deps }) => {
    const projectId = requireProjectScope(deps.project);
    const [page, live] = await Promise.all([
      listProjectDeployments(projectId),
      livePrimaryDeployment(projectId),
    ]);
    return { ...page, live };
  },
  component: DeploymentsScreen,
});

function DeploymentsScreen() {
  const projectId = useRequiredProjectScope();
  const loaded = Route.useLoaderData();
  const router = useRouter();

  const paging = useLoadMore(
    loaded,
    (pageToken) => listProjectDeployments(projectId, pageToken),
    "Could not load more deployments.",
  );
  const deployments = [...loaded.items, ...paging.extra];

  return (
    <Page>
      <ResourceTitle
        action={
          <DeploySheet onDeployed={() => router.invalidate()}>
            {/* `px-2.5!`: `Button`'s `has-[>svg]:px-3` out-specifies a plain
                `px-2.5`. */}
            <Button className="shrink-0 gap-1.5 px-2.5!">
              <Plus aria-hidden />
              New deployment
            </Button>
          </DeploySheet>
        }
      >
        Deployments
      </ResourceTitle>

      <div className={`${RESOURCE_TABLE_WRAP} ${RESOURCE_TABLE_TOP}`}>
        {/* The design draws five near-equal columns around a short id; a real
            release id is thirty characters, and it is the one thing in the row
            that must not clip. Its column takes the width a full id needs at
            the table's narrowest, and below that the table scrolls. */}
        <Table className={cn(RESOURCE_TABLE_FIXED, "min-w-[54rem]")}>
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell className="w-[43%]">Release</ResourceHeadCell>
              <ResourceHeadCell className="w-[15%]">Deployed to</ResourceHeadCell>
              <ResourceHeadCell className="w-[14%]">Status</ResourceHeadCell>
              <ResourceHeadCell className="w-[18%]">Deployed</ResourceHeadCell>
              <ResourceMenuHead className="w-[10%]" />
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {deployments.length === 0 ? (
              <ResourceEmptyRow colSpan={5}>This project has no deployments.</ResourceEmptyRow>
            ) : (
              deployments.map((deployment) => (
                <DeploymentRowItem
                  key={deployment.id}
                  deployment={deployment}
                  live={loaded.live}
                  onChanged={() => router.invalidate()}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <LoadMore paging={paging} />
    </Page>
  );
}
