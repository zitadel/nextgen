import { Link, useNavigate } from "@tanstack/react-router";
import { Layers3 } from "lucide-react";
import { useState } from "react";
import { DeploySheet } from "@/features/deployments/components/deploy-sheet";
import { DeploymentStatusBadge } from "@/features/deployments/components/deployment-status-badge";
import { OriginLink } from "@/components/origin-link";
import { RollbackSheet } from "@/features/deployments/components/rollback-sheet";
import {
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_ROW_ICON,
  RESOURCE_ROW_LINK,
  ResourceRow,
  RowMenu,
} from "@/components/resource-list";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TableCell } from "@/components/ui/table";
import { formatRecent } from "@/lib/date";
import {
  type Deployment,
  KIND_LABEL,
  releaseRevoked,
  rollbackChangesNothing,
} from "@/features/deployments/deployment";

/** One row of the directory. The whole row opens the release it deployed. */
export function DeploymentRowItem({
  deployment,
  live,
  onChanged,
}: {
  deployment: Deployment;
  /** The deployment the primary origins serve now. */
  live?: Deployment;
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
  // cannot go live again; and an earlier deployment of the live release to
  // the same origins would change nothing. None of those rows offers it. A superseded row rolls back
  // to itself; the live row opens the choice of what to go back to.
  const rollback =
    deployment.kind === "primary" &&
    !releaseRevoked(deployment) &&
    (deployment.status === "live" || !rollbackChangesNothing(deployment, live));

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
                <OriginLink
                  origin={origin}
                  className="min-w-0 text-xs font-normal text-foreground"
                  iconClassName="text-muted-foreground"
                />
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
