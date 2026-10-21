import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Layers3, Link as LinkIcon, Plus } from "lucide-react";
import { useState } from "react";

import { DeploySheet } from "@/components/deploy-sheet";
import { NoticeDialog } from "@/components/notice-dialog";
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
  ResourcePage,
  ResourceRow,
  ResourceTitle,
  RowMenu,
} from "@/components/resource-list";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { useLoadMore } from "@/hooks/use-load-more";
import { formatRecent } from "@/lib/date";
import {
  type Deployment,
  KIND_LABEL,
  listProjectDeployments,
  releaseRevoked,
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
  // Order 6: Login flows sits at 5, with Branding nested under it; Project
  // settings stays last at 7.
  staticData: { scope: "project", nav: { label: "Deployments", order: 7, icon: Layers3 } },
  loaderDeps: projectScopeDeps,
  loader: ({ deps }) => listProjectDeployments(requireProjectScope(deps.project)),
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
  // The newest primary deployment is the live one, and it is on the first
  // page: a superseded row of its release has nothing to roll back to.
  const liveReleaseId = deployments.find(
    (deployment) => deployment.kind === "primary" && deployment.status === "live",
  )?.release_id;

  return (
    <ResourcePage>
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
            that must not clip, so its column takes a third. */}
        <Table className={RESOURCE_TABLE_FIXED}>
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell className="w-[34%]">Release</ResourceHeadCell>
              <ResourceHeadCell className="w-[18%]">Deployed to</ResourceHeadCell>
              <ResourceHeadCell className="w-[16%]">Status</ResourceHeadCell>
              <ResourceHeadCell className="w-[20%]">Deployed</ResourceHeadCell>
              <ResourceMenuHead className="w-[12%]" />
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
    </ResourcePage>
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
  const [blockedOpen, setBlockedOpen] = useState(false);
  // The drawer deploys to the primary origins; a preview row's redeploy
  // waits on its Preview card. A revoked release cannot go live again.
  const redeploy = deployment.kind === "primary" && !releaseRevoked(deployment);
  // Previews are deployed to again rather than rolled back; a revoked release
  // cannot go live again; and an earlier deployment of the live release would
  // change nothing. None of those rows offers it. The live row does, to say
  // why it cannot.
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
        {deployment.status === "live" ? (
          <StatusBadge status="active" />
        ) : (
          <Badge variant="secondary">Superseded</Badge>
        )}
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
          {/* The live row has nothing to go back to, and says so rather than
              opening a drawer with the choice missing. */}
          {rollback && (
            <DropdownMenuItem
              onSelect={() =>
                deployment.status === "live" ? setBlockedOpen(true) : setRollbackOpen(true)
              }
            >
              Rollback
            </DropdownMenuItem>
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
          deploymentId={deployment.id}
          open={rollbackOpen}
          onOpenChange={setRollbackOpen}
          onRolledBack={onChanged}
        />
        <NoticeDialog
          open={blockedOpen}
          onOpenChange={setBlockedOpen}
          title="Deployment cannot be rolled back"
          description="Only superseded deployments can be rolled back."
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
  const origins = deployment.targets.map((target) => target.origin);
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
            {origins.length} {origins.length === 1 ? "origin" : "origins"}
          </Button>
        </PopoverTrigger>
        {/* Each origin opens what it serves, and copies in full: a preview
            URL is long, and the one on screen is the one to paste. */}
        <PopoverContent align="start" className="w-auto max-w-96 p-2">
          <ul className="flex flex-col gap-1">
            {origins.map((origin) => (
              <li key={origin} className="flex min-w-0 items-center gap-1">
                <Button
                  asChild
                  variant="link"
                  size="xs"
                  className="h-6 min-w-0 px-0! text-xs font-normal text-foreground"
                >
                  <a href={origin} target="_blank" rel="noreferrer">
                    <LinkIcon aria-hidden className="text-muted-foreground" />
                    <span className="truncate">{origin}</span>
                  </a>
                </Button>
                <CopyButton value={origin} label={`Copy ${origin}`} className="size-6 shrink-0" />
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      <span className="text-xs leading-4 text-muted-foreground">{KIND_LABEL[deployment.kind]}</span>
    </div>
  );
}
