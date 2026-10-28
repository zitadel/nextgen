import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";

import { api } from "@/api/zitadel";
import { DETAIL_BODY, DetailSection } from "@/components/detail-page";
import { DocumentViewer } from "@/components/document-viewer";
import { Page } from "@/components/layout";
import { SchemaFieldsPanel } from "@/components/schema-fields-panel";
import { PAGE_TITLE } from "@/components/typography";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
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
import { cn } from "@/lib/utils";

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
 * migrated through the API, which an older revision says under the card title.
 *
 * The header is the title over one line of identity (id and created date), not
 * the resource screens' icon tile and meta card: the design draws this screen
 * that way. Each tab is a `DetailSection`, with the revision picker as the
 * card's action, since the revision applies to the whole schema.
 */
function SchemaDetail() {
  const { schema, createdAt, revisions } = Route.useLoaderData();
  const { schemaId } = Route.useParams();
  const name = schemaDisplayName(schema, schemaId);
  const methods = schemaAuthMethods(schema);
  const older = revisions.length > 0 && revisions[0]?.id !== schemaId;
  const picker = revisions.length > 0 && (
    <RevisionSelect revisions={revisions} current={schemaId} />
  );
  const note = older && (
    <p className="text-muted-foreground text-sm">
      Not the newest revision. Users stay on the revision they were created on until they are
      migrated through the API.
    </p>
  );

  return (
    <Page>
      <header className="flex flex-col gap-2 px-2">
        <h1 className={cn(PAGE_TITLE, "wrap-anywhere")}>{name}</h1>
        {/* The design draws `Expires at` here; nothing on the schema resource
            backs it, so the created date stands in. */}
        {/* Stacked under `sm`, where the id alone fills the line; the rule
            between the two values only exists in the row layout. */}
        <div className="text-muted-foreground flex flex-col gap-1 text-xs leading-4 sm:flex-row sm:items-center">
          <span className="flex flex-wrap items-center gap-x-1">
            <span className="whitespace-nowrap">Schema ID</span>
            <span className="flex items-center gap-1">
              <span className="text-foreground">{schemaId}</span>
              <CopyButton value={schemaId} label="Copy Schema ID" size="inline" />
            </span>
          </span>
          <span aria-hidden className="bg-border mx-4.5 hidden h-4 w-px shrink-0 sm:block" />
          <span className="flex items-center gap-1">
            <span>Created</span>
            <span>{formatDate(createdAt)}</span>
          </span>
        </div>
      </header>

      <Tabs defaultValue="fields" className={`${DETAIL_BODY} gap-6`}>
        <TabsList aria-label="Schema detail sections">
          <TabsTrigger value="fields">Fields</TabsTrigger>
          <TabsTrigger value="authentication">Authentication</TabsTrigger>
        </TabsList>

        <TabsContent value="fields">
          <DetailSection title="Field definitions" action={picker} note={note}>
            {/* The field table and the viewer split the card, matching height;
                stacked below `lg`, where the design puts the viewer under the
                table. */}
            <div className="flex flex-col gap-4.5 lg:flex-row lg:items-stretch">
              <div className="min-w-0 lg:flex-1">
                <SchemaFieldsPanel schema={schema} />
              </div>
              <DocumentViewer document={schema} noun="schema" />
            </div>
          </DetailSection>
        </TabsContent>

        <TabsContent value="authentication">
          <DetailSection title="Sign-in methods" action={picker} note={note}>
            {methods.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This schema declares no sign-in methods.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {methods.map((method, index) => (
                  <Fragment key={method.key}>
                    {index > 0 && <Separator className={RULE} />}
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
                ))}
              </div>
            )}
          </DetailSection>
        </TabsContent>
      </Tabs>
    </Page>
  );
}

/**
 * The revision picker: each revision by its id and creation time, newest first
 * and marked `latest`. Picking one opens that revision's own page, since each
 * is a schema of its own; the project scope rides along in the search.
 */
function RevisionSelect({
  revisions,
  current,
}: {
  revisions: SchemaRevision[];
  current: string;
}): ReactNode {
  const navigate = useNavigate({ from: Route.fullPath });
  const latest = revisions[0]?.id;
  return (
    <Select
      value={current}
      onValueChange={(schemaId) =>
        void navigate({ to: "/schemas/$schemaId", params: { schemaId } })
      }
    >
      {/* The design's 36px trigger with the id in the 12px medium sans. */}
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
