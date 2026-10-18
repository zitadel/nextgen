import { createFileRoute } from "@tanstack/react-router";
import { Layers3 } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { api } from "@/api/zitadel";
import { MetaCard, MetaRule, MetaValue } from "@/components/detail-meta";
import { CARD_HEADING, DetailPanel, DetailSection, PanelTitle } from "@/components/detail-page";
import { DocumentViewer } from "@/components/document-viewer";
import { DETAIL_PANEL_PAGE } from "@/components/layout";
import { ReleaseDeployments } from "@/components/release-deployments";
import { ReleaseStatusBadge } from "@/components/release-status-badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatDate } from "@/lib/date";
import { listReleaseDeployments } from "@/lib/deployment";
import { projectScopeDeps, requireProjectScope } from "@/lib/project-scope";
import {
  type PointerGroup,
  type Release,
  groupPointers,
  releaseStatus,
  resolvePointer,
  shortSha,
} from "@/lib/release";

/**
 * Release detail: the header, the configuration the release pins, where it
 * went, and its metadata.
 *
 * The design also draws the actions on a release: **Deploy** in the header
 * and **Redeploy**, **Rollback** and **Revoke release** under its menu. They
 * are #1857's, once the API serves the writes.
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

  return (
    <div className={`${DETAIL_PANEL_PAGE} flex flex-col gap-6`}>
      <DetailPanel>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Stacks below `sm`, as the mobile frame puts the pill under the title. */}
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
            <PanelTitle icon={Layers3} title={release.id} />
            <ReleaseStatusBadge status={releaseStatus(release)} />
          </div>

          <MetaCard bordered={false}>
            <MetaValue label="Release ID" value={release.id} size="sm" copyable />
            <MetaRule />
            <MetaValue label="Created" value={formatDate(release.metadata.created_at)} size="sm" />
          </MetaCard>
        </div>

        <Separator />

        {/* The section's own heading, ruled off from the groups it heads. */}
        <h2 className={CARD_HEADING}>Release content</h2>
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
  );
}

/**
 * One kind's pointers: the heading in a 216px column at `lg`, with the list
 * flush against it, and stacked above the list below `lg`. Each pointer is an
 * accordion row that opens to its document.
 */
function PointerGroupSection({ group }: { group: PointerGroup }) {
  return (
    <section className="flex flex-col gap-4 py-1 lg:flex-row lg:items-start lg:gap-0">
      <h2 className="text-sm leading-5 text-muted-foreground lg:w-54 lg:shrink-0">{group.label}</h2>
      <Accordion type="multiple" className="min-w-0 flex-1">
        {/* 16px above and below the rule between rows, as the frame draws it;
            the group's own rule follows the last row at the section gap. */}
        {group.pointers.map((pointer) => (
          <AccordionItem
            key={pointer.revisionId}
            value={pointer.revisionId}
            className="py-4 first:pt-0 last:pb-0"
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
                <span className="text-sm leading-5 font-medium text-foreground">
                  {pointer.name}
                </span>{" "}
                {/* A schema's revision id can be a URL the operator authored;
                    the badge clips it rather than widening the row. `shrink`
                    overrides the pill's own `shrink-0`: a pill that will not
                    shrink pushes the chevron out of the card on a phone. */}
                <Badge variant="secondary" className="min-w-0 max-w-full shrink">
                  <span className="truncate">{pointer.revisionId}</span>
                </Badge>
              </span>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-4">
              {pointer.document === undefined ? (
                <p className="text-sm text-muted-foreground">
                  This revision could not be read, so its document cannot be shown.
                </p>
              ) : (
                <DocumentViewer document={pointer.document} noun={group.noun} />
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

/** The card of labelled values under the panel: message, commit, author. */
function ReleaseMetadata({ release }: { release: Release }) {
  const { message, git_sha, git_dirty, created_by } = release.metadata;
  return (
    <DetailSection title="Metadata" titleStyle="heading">
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
