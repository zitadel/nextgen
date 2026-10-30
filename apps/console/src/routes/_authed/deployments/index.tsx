import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Layers3, Plus } from "lucide-react";
import { useState } from "react";

import { DeploySheet } from "@/components/deploy-sheet";
import { DeploymentStatusBadge } from "@/components/deployment-status-badge";
import { TargetLink } from "@/components/origin-link";
import { RollbackSheet } from "@/components/rollback-sheet";

import {
  LoadMore,
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_ROW_ICON,
  RESOURCE_ROW_LINK,
  RESOURCE_TABLE_FIXED,
  RESOURCE_TABLE_TOP,
  RESOURCE_TABLE_WRAP,
  ResourceEmptyRow,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceMenuHead,
  ResourceRow,
  ResourceTitle,
  RowMenu,
} from "@/components/resource-list";
import { Page } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { useLoadMore } from "@/hooks/use-load-more";
import { formatRecent } from "@/lib/date";
import { cn } from "@/lib/utils";
import {
  type Deployment,
  KIND_LABEL,
  listProjectDeployments,
  releaseRevoked,
  livePrimaryReleaseId,
  targetName,
} from "@/lib/deployment";
import {
  projectScopeDeps,
  requireProjectScope,
  useRequiredProjectScope,
} from "@/lib/project-scope";

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
  // The live primary release is read on its own: the newest page is not
  // guaranteed to hold the live primary row once previews outnumber it.
  loader: async ({ deps }) => {
    const projectId = requireProjectScope(deps.project);
    const [page, liveReleaseId] = await Promise.all([
      listProjectDeployments(projectId),
      livePrimaryReleaseId(projectId),
    ]);
    return { ...page, liveReleaseId };
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
  // A superseded row of the live release has nothing to roll back to.
  const liveReleaseId = loaded.liveReleaseId;

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
                  liveReleaseId={liveReleaseId}
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

/** One row of the directory. The whole row opens the release it deployed. */
function DeploymentRowItem({
  deployment,
  liveReleaseId,
  onChanged,
}: {
  deployment: Deployment;
  /** The release the primary origins serve now. */
  liveReleaseId?: string;
  onChanged: () => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const params = { releaseId: deployment.release_id };
  const [redeployOpen, setRedeployOpen] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  // The drawer deploys to the primary origins only, so a preview row has no
  // redeploy. A revoked release cannot go live again.
  const redeploy = deployment.kind === "primary" && !releaseRevoked(deployment);
  // Previews are deployed to again rather than rolled back; a revoked release
  // cannot go live again; and an earlier deployment of the live release would
  // change nothing. None of those rows offers it. A superseded row rolls back
  // to itself; the live row opens the choice of what to go back to.
  const rollback =
    deployment.kind === "primary" &&
    !releaseRevoked(deployment) &&
    (deployment.status === "live" || deployment.release_id !== liveReleaseId);

  return (
    <ResourceRow onOpen={() => void navigate({ to: "/releases/$releaseId", params })}>
      <TableCell className={RESOURCE_CELL}>
        <span className="flex min-w-0 items-center gap-1.5">
          <Link to="/releases/$releaseId" params={params} className={RESOURCE_ROW_LINK}>
            <Layers3 aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
            <span className="truncate">{deployment.release_id}</span>
          </Link>
          {/* Sized under the row's text so the copy affordance never drives
              the row height. */}
          <CopyButton
            value={deployment.release_id}
            label={`Copy release ID ${deployment.release_id}`}
            className="size-6 shrink-0"
          />
        </span>
      </TableCell>
      <TableCell className={RESOURCE_CELL}>
        <Targets deployment={deployment} />
      </TableCell>
      <TableCell className={RESOURCE_CELL}>
        <DeploymentStatusBadge status={deployment.status} />
      </TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>
        <time dateTime={deployment.deployed_at}>{formatRecent(deployment.deployed_at)}</time>
      </TableCell>
      <TableCell className={`${RESOURCE_CELL} text-right`}>
        <RowMenu name={deployment.id}>
          <DropdownMenuItem asChild>
            <Link to="/releases/$releaseId" params={params}>
              View release
            </Link>
          </DropdownMenuItem>
          {(redeploy || rollback) && <DropdownMenuSeparator />}
          {redeploy && (
            <DropdownMenuItem onSelect={() => setRedeployOpen(true)}>Redeploy</DropdownMenuItem>
          )}
          {rollback && (
            <DropdownMenuItem onSelect={() => setRollbackOpen(true)}>Rollback</DropdownMenuItem>
          )}
        </RowMenu>
        {/* Outside the menu and opened by state, so the menu closes on select
            instead of keeping the page `aria-hidden` under the drawer. */}
        <DeploySheet
          release={{ id: deployment.release_id }}
          intent="redeploy"
          open={redeployOpen}
          onOpenChange={setRedeployOpen}
          onDeployed={onChanged}
        />
        <RollbackSheet
          deploymentId={deployment.status === "live" ? undefined : deployment.id}
          open={rollbackOpen}
          onOpenChange={setRollbackOpen}
          onRolledBack={onChanged}
        />
      </TableCell>
    </ResourceRow>
  );
}

/**
 * Where the deployment went: the origins counted, with the kind under the
 * count. The count opens the list: each origin opens its target and copies.
 */
function Targets({ deployment }: { deployment: Deployment }) {
  const { targets } = deployment;
  return (
    <div className="flex min-w-0 flex-col">
      <Popover>
        <PopoverTrigger asChild>
          {/* `px-0!`: the size's `has-[>svg]:px-*` is a variant and
              out-specifies a plain `px-0`. */}
          <Button
            variant="link"
            size="xs"
            className="h-5 w-fit px-0! text-sm font-normal text-foreground"
          >
            {targets.length} {targets.length === 1 ? "target" : "targets"}
          </Button>
        </PopoverTrigger>
        {/* Each origin opens what it serves, and copies in full: a preview
            URL is long, and the one on screen is the one to paste. */}
        <PopoverContent align="start" className="w-auto max-w-96 p-2">
          <ul className="flex flex-col gap-1">
            {targets.map((target) => (
              <li key={targetName(target)} className="flex min-w-0 items-center gap-1">
                <TargetLink
                  target={target}
                  className="min-w-0 text-xs font-normal text-foreground"
                  iconClassName="text-muted-foreground"
                />
                {target.type === "origin" ? (
                  <CopyButton
                    value={target.origin}
                    label={`Copy ${target.origin}`}
                    className="size-6 shrink-0"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      <span className="text-xs leading-4 text-muted-foreground">{KIND_LABEL[deployment.kind]}</span>
    </div>
  );
}
