import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Braces } from "lucide-react";
import { Fragment } from "react";

import { api } from "@/api/zitadel";
import { MetaCard, MetaRule, MetaValue } from "@/components/detail-meta";
import { DetailPanel, PanelTitle } from "@/components/detail-page";
import { DocumentViewer } from "@/components/document-viewer";
import { Page } from "@/components/layout";
import { SchemaFieldsPanel } from "@/components/schema-fields-panel";
import { SECTION_HEADING, SUBSECTION_HEADING } from "@/components/typography";
import { Badge } from "@/components/ui/badge";
import { InlineCode } from "@/components/ui/inline-code";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatDateTime } from "@/lib/date";
import { projectScopeDeps, requireProjectScope } from "@/lib/project-scope";
import {
  type SchemaRevision,
  type UserSchema,
  fetchSchemaRevisions,
  schemaAuthMethods,
  schemaDisplayName,
} from "@/lib/schema";

export const Route = createFileRoute("/_authed/schemas/$schemaId")({
  staticData: { scope: "project", resource: "user schema" },
  loaderDeps: projectScopeDeps,
  // Schema ids are unique per project only (the seeded default carries the same
  // `$id` everywhere), and an ambiguous id resolves in the caller's own project
  // unless `project_id` names the selected one.
  loader: async ({ params, deps }) => {
    const projectId = requireProjectScope(deps.project);
    const body = await api.getSchemaById(params.schemaId, { project_id: projectId });
    const schema = body.schema as UserSchema;
    // The history is keyed by the document's own `objectType`, so it is read
    // after the document. A schema stored without one is a revision of
    // nothing, and has no history to list.
    const objectType = typeof schema.objectType === "string" ? schema.objectType : undefined;
    const revisions = objectType ? await fetchSchemaRevisions(projectId, objectType) : [];
    return { schema, createdAt: body.metadata.created_at, revisions };
  },
  component: SchemaDetail,
});

/**
 * The schema at one of its revisions, with every other revision a pick away
 * (#1670). A revision is identified by its id and its creation time (decisions
 * log D10), and the newest is marked `latest`; none is called active, because
 * which revision serves new registrations is the release's choice, not the
 * schema's. Users stay on the revision they were created on until they are
 * migrated through the API, which an older revision says under the tab row.
 */

function SchemaDetail() {
  const { schema, createdAt, revisions } = Route.useLoaderData();
  const { schemaId } = Route.useParams();
  const name = schemaDisplayName(schema, schemaId);
  const methods = schemaAuthMethods(schema);
  const older = revisions.length > 0 && revisions[0]?.id !== schemaId;

  return (
    <Page inset="panel">
      <DetailPanel>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <PanelTitle icon={Braces} title={name} />
          {/* The same header card as Login flows. The design draws a third
              value, `EXPIRES AT`; nothing on the schema resource backs it. */}
          <MetaCard bordered={false}>
            <MetaValue label="Schema ID" value={schemaId} copyable />
            <MetaRule />
            <MetaValue label="Created" value={formatDate(createdAt)} />
          </MetaCard>
        </div>

        <Separator />

        <Tabs defaultValue="fields" className="gap-4.5">
          {/* `py-[3px]` only — this strip has no horizontal padding, which is
              what puts the first trigger's box flush with the card's content
              edge and its label in line with `SCHEMA` below. (The viewer's own
              JSON/YAML strip does use `p-[3px]`.) */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <TabsList className="h-10 px-0 py-[3px]">
              <TabsTrigger value="fields" variant="muted">
                Fields
              </TabsTrigger>
              <TabsTrigger value="authentication" variant="muted">
                Authentication
              </TabsTrigger>
            </TabsList>
            {/* On the tab row, as the design draws it: the revision applies to
                both tabs. */}
            {revisions.length > 0 && <RevisionSelect revisions={revisions} current={schemaId} />}
          </div>

          {older && (
            <p className="text-muted-foreground px-2 text-sm">
              Not the newest revision. Users stay on the revision they were created on until they
              are migrated through the API.
            </p>
          )}

          <TabsContent value="fields">
            {/* The field table is a fixed 468px and the viewer takes the rest,
                matching height. Stacked below `lg`, where the design puts the
                viewer under the table.

                `pl-2` because the design insets this row by 8px on the left
                while the tab strip above starts at the content edge: a tab
                trigger is `px-2`, so the effect is that the heading and `SCHEMA` line
                up with the tab *label* and the tab's box sits just outside it. */}
            <div className="flex flex-col gap-4.5 lg:flex-row lg:items-stretch lg:pl-2">
              <div className="flex flex-col gap-4 lg:w-[468px] lg:shrink-0">
                <h2 className={SECTION_HEADING}>Field definitions</h2>
                <SchemaFieldsPanel schema={schema} />
              </div>
              <DocumentViewer document={schema} noun="schema" />
            </div>
          </TabsContent>

          <TabsContent value="authentication">
            {/* `px-2`, the same 8px inset the Fields tab uses, so the section
                heading lines up with the tab label above it rather than with
                the tab's box. */}
            <section className="flex flex-col gap-2.5 px-2">
              <h2 className={SUBSECTION_HEADING}>Sign-in methods</h2>
              {methods.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This schema declares no sign-in methods.
                </p>
              ) : (
                methods.map((method) => (
                  <Fragment key={method.key}>
                    <Separator className={RULE} />
                    <div className="flex items-center justify-between gap-4 py-1">
                      <span className="text-sm leading-5 font-medium text-foreground">
                        {method.label}
                      </span>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {/* Raw slugs: resolving them to connection names needs
                            `idp.read`, which this screen does not assume. A
                            slug with no connection reads the same — the
                            Authentication screen is where that is flagged. */}
                        {method.providers.map((slug) => (
                          <InlineCode key={slug}>{slug}</InlineCode>
                        ))}
                        <Badge variant="secondary" className="h-5">
                          {method.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                    </div>
                  </Fragment>
                ))
              )}
            </section>
          </TabsContent>
        </Tabs>
      </DetailPanel>
    </Page>
  );
}

/**
 * The revision picker: each revision by its id and creation time, newest first
 * and marked `latest`. Picking one opens that revision's own page, since each
 * is a schema of its own; the project scope rides along in the search.
 */
function RevisionSelect({ revisions, current }: { revisions: SchemaRevision[]; current: string }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const latest = revisions[0]?.id;
  return (
    <Select
      value={current}
      onValueChange={(schemaId) =>
        void navigate({ to: "/schemas/$schemaId", params: { schemaId } })
      }
    >
      {/* The design's 36px trigger with the id in the 12px medium sans, not
          the meta card's mono. */}
      <SelectTrigger aria-label="Schema revision" className="max-w-full">
        {/* Custom content: the id alone, without the item's timestamp, keeps
            the trigger to the design's one id and badge. */}
        <SelectValue>
          <span className="truncate text-xs font-medium">{current}</span>
          {current === latest && <LatestBadge />}
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" sideOffset={4} align="end">
        {revisions.map((revision) => (
          <SelectItem key={revision.id} value={revision.id} className="gap-2">
            <span className="text-xs font-medium">{revision.id}</span>
            <span className="text-muted-foreground text-xs">
              {formatDateTime(revision.createdAt)}
            </span>
            {revision.id === latest && <LatestBadge />}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LatestBadge() {
  return (
    <Badge variant="secondary" className="h-5">
      latest
    </Badge>
  );
}

// The rules between sign-in methods take no vertical space: the design draws
// them as zero-height lines with the hairline outside the box, so the 10px
// column gap sits either side of the rule rather than 10px + the rule's own
// height. `Separator` is `h-px`, which is enough to drift the rows below it.
const RULE = "h-0 border-t border-border bg-transparent";
