import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { api } from "@/api/zitadel";
import {
  DETAIL_BODY,
  DETAIL_STACK,
  DETAIL_VALUE_EMPTY,
  DetailRow,
  DetailRows,
  DetailSection,
  DetailHeader,
} from "@/components/detail-page";
import { DocumentViewer } from "@/components/document-viewer";
import { Page } from "@/components/layout";
import { formatDate } from "@/lib/date";
import { SchemaFieldsPanel } from "@/features/schemas/components/schema-fields-panel";
import { Badge } from "@/components/ui/badge";
import { InlineCode } from "@/components/ui/inline-code";
import {
  REVISION_MENU,
  REVISION_TRIGGER,
  RevisionItems,
  RevisionValue,
} from "@/features/schemas/components/revision-select";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { field } from "@/lib/record";
import { fetchLatestSchemaId, fetchSchemaRevisions } from "@/features/schemas/api";
import {
  type SchemaRevision,
  type UserSchema,
  schemaAuthMethods,
  schemaDisplayName,
} from "@/features/schemas/model";

export const Route = createFileRoute("/_authed/schemas/$schemaId")({
  staticData: { scope: "project", resource: "user schema" },
  loaderDeps: projectScopeDeps,
  // Schema ids are unique per project only (the seeded default carries the same
  // `$id` everywhere), and an ambiguous id resolves in the caller's own project
  // unless `project_id` names the selected one.
  loader: async ({ params, deps }) => {
    const projectId = requireProjectScope(deps.project);
    const body = await api.getSchema(params.schemaId, { project_id: projectId });
    const schema = body.schema as UserSchema;
    // The history is keyed by the document's own `objectType`, so it is read
    // after the document. A schema stored without one is a revision of
    // nothing, and has no history to list. The history is chrome: a failed
    // read leaves the schema on screen without a picker. `inUse` marks the
    // revisions some user is still on, as the Users filter does.
    // `Latest` comes from the latest-of-type read: the history leaves out a
    // revision the viewer may not read, so its first entry may not be it.
    const objectType = field(schema, "objectType");
    const [revisions, latestId] = objectType
      ? await Promise.all([
          fetchSchemaRevisions(projectId, objectType, { inUse: true }).catch(() => []),
          fetchLatestSchemaId(projectId, objectType).catch(() => undefined),
        ])
      : [[], undefined];
    return { schema, createdAt: body.metadata.created_at, revisions, latestId };
  },
  component: SchemaDetail,
});

/**
 * The schema at one of its revisions, with every other revision a pick away
 * (#1670). A revision is identified by its id and its creation time (decisions
 * log D10), and the newest is marked `Latest`; none is called active, because
 * which revision serves new registrations is the release's choice, not the
 * schema's. The picker's `Latest` and `In use` badges say where the shown
 * revision stands.
 *
 * The header is `DetailHeader`, the title over one line of identity, as the
 * design draws this screen. Each tab is a `DetailSection`; the Fields card
 * carries the revision picker as its action.
 */
function SchemaDetail() {
  const { schema, createdAt, revisions, latestId } = Route.useLoaderData();
  const { schemaId } = Route.useParams();
  const name = schemaDisplayName(schema, schemaId);
  const methods = schemaAuthMethods(schema);
  // A document the history leaves out (stored without `kind`) has no place
  // in the picker.
  const listed = revisions.some((revision) => revision.id === schemaId);
  const picker = listed && (
    <RevisionSelect revisions={revisions} latestId={latestId} current={schemaId} />
  );

  return (
    <Page>
      {/* The design draws `Expires at` beside the id; nothing on the schema
          resource backs it, so the created date stands in. */}
      <DetailHeader
        title={name}
        meta={[
          { label: "Schema ID", value: schemaId, copyable: true },
          { label: "Created", value: createdAt ? formatDate(createdAt) : undefined },
        ]}
      />

      <Tabs defaultValue="fields" className={`${DETAIL_BODY} ${DETAIL_STACK}`}>
        <TabsList aria-label="Schema detail sections">
          <TabsTrigger value="fields">Fields</TabsTrigger>
          <TabsTrigger value="authentication">Authentication</TabsTrigger>
        </TabsList>

        <TabsContent value="fields">
          <DetailSection title="Field definitions" action={picker}>
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
          {/* No picker here: the design draws it on the Fields card only. */}
          <DetailSection title="Sign-in methods">
            {methods.length === 0 ? (
              <p className={DETAIL_VALUE_EMPTY}>This schema declares no sign-in methods.</p>
            ) : (
              <DetailRows>
                {methods.map((method) => (
                  <DetailRow key={method.key} align="center" label={method.label}>
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
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
                  </DetailRow>
                ))}
              </DetailRows>
            )}
          </DetailSection>
        </TabsContent>
      </Tabs>
    </Page>
  );
}

/**
 * The revision picker, drawn as the Users list's revision filter is (#2502):
 * each revision by its shortened id, creation time and badges, newest first.
 * Picking one opens that revision's own page, since each is a schema of its
 * own; the project scope rides along in the search.
 */
function RevisionSelect({
  revisions,
  latestId,
  current,
}: {
  revisions: SchemaRevision[];
  latestId?: string;
  current: string;
}) {
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <Select
      value={current}
      onValueChange={(schemaId) =>
        void navigate({ to: "/schemas/$schemaId", params: { schemaId } })
      }
    >
      <SelectTrigger aria-label="Schema revision" className={`${REVISION_TRIGGER} pr-2 pl-2.5`}>
        <SelectValue>
          <span className="text-muted-foreground">Revision</span>
          {/* 12px, as the design draws it on this card: at 14px the id is cut
              short on a phone, where the trigger takes the card's width. */}
          <RevisionValue
            revisions={revisions}
            latestId={latestId}
            id={current}
            className="text-xs"
          />
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" sideOffset={4} align="end" className={REVISION_MENU}>
        <RevisionItems revisions={revisions} latestId={latestId} />
      </SelectContent>
    </Select>
  );
}
