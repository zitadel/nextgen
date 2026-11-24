import { EllipsisVertical, GitCommitHorizontal } from "lucide-react";
import { useState } from "react";
import { DeploySheet } from "@/features/deployments/components/deploy-sheet";
import { DetailAccordion, DetailAccordionItem } from "@/components/detail-accordion";
import { DETAIL_VALUE, DetailRow, DetailRows, DetailSection } from "@/components/detail-page";
import { DocumentViewer } from "@/components/document-viewer";
import { RevokeReleaseDialog } from "@/features/deployments/components/revoke-release-dialog";
import { RollbackSheet } from "@/features/deployments/components/rollback-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Deployment } from "@/features/deployments/deployment";
import type { PolicySetting } from "@/features/deployments/policy";
import { type PointerGroup, type Release, shortSha } from "@/features/deployments/release";

/**
 * The header's menu: **Redeploy** is the deploy drawer for this release with
 * its own copy, or **Deploy** with the plain copy while the primary origins
 * have never served it; **Rollback** opens the drawer with this release's
 * newest superseded primary deployment chosen, and is left out until the
 * release has a primary deployment to go back to; **Revoke release** asks
 * first, and refuses at once while an origin serves it.
 *
 * Each opens by state, outside the menu, so the menu closes on select.
 */
export function ReleaseActions({
  release,
  deployments,
  inUse,
  onChanged,
}: {
  release: Release;
  deployments: Deployment[];
  /** Whether an origin still serves the release, which refuses a revoke. */
  inUse: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [redeployOpen, setRedeployOpen] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const superseded = deployments.find(
    (deployment) => deployment.kind === "primary" && deployment.status !== "live",
  );
  const deployedToPrimary = deployments.some((deployment) => deployment.kind === "primary");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label={`Actions for ${release.id}`}>
            <EllipsisVertical aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={() => setRedeployOpen(true)}>
            {deployedToPrimary ? "Redeploy" : "Deploy"}
          </DropdownMenuItem>
          {deployedToPrimary && (
            <DropdownMenuItem onSelect={() => setRollbackOpen(true)}>Rollback</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setRevokeOpen(true)}>
            Revoke release
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeploySheet
        release={release}
        intent={deployedToPrimary ? "redeploy" : "deploy"}
        open={redeployOpen}
        onOpenChange={setRedeployOpen}
        onDeployed={onChanged}
      />
      <RollbackSheet
        deploymentId={superseded?.id}
        open={rollbackOpen}
        onOpenChange={setRollbackOpen}
        onRolledBack={onChanged}
      />
      <RevokeReleaseDialog
        releaseId={release.id}
        inUse={inUse}
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        onRevoked={onChanged}
        onRefused={onChanged}
      />
    </>
  );
}

/**
 * One kind's pointers: the kind as the row's label, and an accordion row per
 * pointer that opens to its document.
 */
export function PointerGroupSection({ group }: { group: PointerGroup }) {
  return (
    <DetailRow align="control" label={<h3>{group.label}</h3>}>
      <DetailAccordion>
        {group.pointers.map((pointer) => (
          <DetailAccordionItem
            key={pointer.revisionId}
            value={pointer.revisionId}
            title={
              <>
                {/* The literal space is for the accessible name: a flex row drops it
                    visually, and without it the row reads "Customersch_1". */}
                <span>{pointer.name}</span>{" "}
                {/* The commit glyph says the id names one revision of the
                    resource, not that the revision is in any state. A schema's
                    revision id can be a URL the operator authored; the badge
                    clips it rather than widening the row. `shrink` overrides
                    the pill's own `shrink-0`: a pill that will not shrink
                    pushes the chevron out of the card on a phone. */}
                <Badge variant="secondary" className="min-w-0 max-w-full shrink">
                  <GitCommitHorizontal aria-hidden="true" />
                  <span className="truncate">{pointer.revisionId}</span>
                </Badge>
              </>
            }
          >
            {pointer.document === undefined ? (
              <p className="text-sm text-muted-foreground">
                This revision could not be read, so its document cannot be shown.
              </p>
            ) : (
              <>
                {pointer.settings?.length ? (
                  <PolicySettingsRows settings={pointer.settings} />
                ) : null}
                <DocumentViewer document={pointer.document} noun={group.noun} />
              </>
            )}
          </DetailAccordionItem>
        ))}
      </DetailAccordion>
    </DetailRow>
  );
}

/**
 * A policy's settings above its document, as labelled rows. They sit in the
 * pointer group's value column, so they stack on that column's width rather
 * than the viewport's.
 */
function PolicySettingsRows({ settings }: { settings: PolicySetting[] }) {
  return (
    <DetailRows container>
      {settings.map((setting) => (
        <DetailRow key={setting.label} label={setting.label}>
          <span className={DETAIL_VALUE}>{setting.value}</span>
        </DetailRow>
      ))}
    </DetailRows>
  );
}

/** The card of labelled values under the release content: message, commit, author. */
export function ReleaseMetadata({ release }: { release: Release }) {
  const { message, git_sha, git_dirty, created_by } = release.metadata;
  return (
    <DetailSection title="Metadata">
      <DetailRows>
        <DetailRow label="Message">
          <span className={DETAIL_VALUE}>{message || "—"}</span>
        </DetailRow>
        {/* `git_dirty` means the tree had uncommitted changes, so the commit
            names what the release was built near, not what it was built from. */}
        <DetailRow label="Git commit">
          <span className={DETAIL_VALUE}>
            {git_sha ? (
              <span title={git_sha}>
                {shortSha(git_sha)}
                {git_dirty && <span className="text-muted-foreground"> · uncommitted changes</span>}
              </span>
            ) : (
              "—"
            )}
          </span>
        </DetailRow>
        {/* The identity id, or nothing: a release built from CI carries none. */}
        <DetailRow label="Created by">
          <span className={DETAIL_VALUE}>{created_by || "—"}</span>
        </DetailRow>
      </DetailRows>
    </DetailSection>
  );
}
