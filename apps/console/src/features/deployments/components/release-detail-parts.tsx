import { Ellipsis, GitCommitHorizontal } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { DeploySheet } from "@/features/deployments/components/deploy-sheet";
import { DetailRow, DetailSection } from "@/components/detail-page";
import { DocumentViewer } from "@/components/document-viewer";
import { RevokeReleaseDialog } from "@/features/deployments/components/revoke-release-dialog";
import { RollbackSheet } from "@/features/deployments/components/rollback-sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
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
          <Button variant="outline" size="icon-sm" aria-label={`Actions for ${release.id}`}>
            <Ellipsis aria-hidden />
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
 * One kind's pointers: the heading in a 216px column at `lg`, with the list
 * flush against it, and stacked above the list below `lg`. Each pointer is an
 * accordion row that opens to its document.
 */
export function PointerGroupSection({ group }: { group: PointerGroup }) {
  return (
    <section className="flex flex-col gap-4 py-3 lg:flex-row lg:items-start lg:gap-0">
      <h2 className="text-sm leading-5 text-muted-foreground lg:w-54 lg:shrink-0">{group.label}</h2>
      <Accordion type="multiple" className="min-w-0 flex-1">
        {/* 12px above and below the rule between rows, a 48px row pitch as the
            frame draws it; the group's own rule follows the last row at the
            section gap. */}
        {group.pointers.map((pointer) => (
          <AccordionItem
            key={pointer.revisionId}
            value={pointer.revisionId}
            className="py-3 first:pt-0 last:pb-0"
          >
            {/* 24px: a 20px line with 2px above and below, so the row's text
                sits level with the group's label. The shared trigger underlines
                on hover and tops its chevron on the first line of a wrapped
                label; this row is one line, centred. `min-w-0` lets the row
                shrink below the pill's text, which is what makes the pill
                truncate on a phone instead of pushing the chevron off the card. */}
            <AccordionTrigger className="min-w-0 items-center py-0.5 hover:no-underline [&>svg]:translate-y-0">
              {/* The literal space is for the accessible name: a flex row drops it
                  visually, and without it the row reads "Customersch_1". */}
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                {/* The shared trigger is medium; the frame sets the name regular. */}
                <span className="text-sm leading-5 font-normal text-foreground">
                  {pointer.name}
                </span>{" "}
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
              </span>
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-4 pt-4 pb-4">
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
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

/**
 * A policy's settings above its document, ruled off as the deployments below
 * them are, with 12px from the text to each rule.
 */
function PolicySettingsRows({ settings }: { settings: PolicySetting[] }) {
  return (
    <div className="flex flex-col gap-3">
      {settings.map((setting, index) => (
        <Fragment key={setting.label}>
          {index > 0 && <Separator />}
          <DetailRow label={setting.label}>
            <span className="min-w-0 text-sm leading-5 text-foreground">{setting.value}</span>
          </DetailRow>
        </Fragment>
      ))}
    </div>
  );
}

/** The card of labelled values under the panel: message, commit, author. */
export function ReleaseMetadata({ release }: { release: Release }) {
  const { message, git_sha, git_dirty, created_by } = release.metadata;
  return (
    <DetailSection title="Metadata">
      <div className="flex flex-col gap-4.5">
        <MetadataRow label="Message">{message || "—"}</MetadataRow>
        <Separator />
        {/* `git_dirty` means the tree had uncommitted changes, so the commit
            names what the release was built near, not what it was built from. */}
        <MetadataRow label="Git commit">
          {git_sha ? (
            <span title={git_sha}>
              {shortSha(git_sha)}
              {git_dirty && <span className="text-muted-foreground"> · uncommitted changes</span>}
            </span>
          ) : (
            "—"
          )}
        </MetadataRow>
        <Separator />
        {/* The identity id, or nothing: a release built from CI carries none. */}
        <MetadataRow label="Created by">{created_by || "—"}</MetadataRow>
      </div>
    </DetailSection>
  );
}

/**
 * The label in the same 216px column the pointer groups use at `lg`, with the
 * value beside it; on a phone the value sits at the row's end.
 */
function MetadataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1 lg:justify-start lg:gap-0">
      <span className="shrink-0 text-sm leading-5 font-medium text-muted-foreground lg:w-54">
        {label}
      </span>
      <span className="min-w-0 text-right text-sm leading-5 text-foreground wrap-anywhere lg:text-left">
        {children}
      </span>
    </div>
  );
}
