import { createFileRoute, Link } from "@tanstack/react-router";

import { api } from "@/api/zitadel";
import { DETAIL_BODY, DetailHeader, DetailSection } from "@/components/detail-page";
import { DocumentViewer } from "@/components/document-viewer";
import { Page } from "@/components/layout";
import { PANEL_BODY_CELL, PANEL_HEAD_CELL } from "@/components/typography";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/date";
import {
  type FlowDefinition,
  type FlowStep,
  flowDisplayName,
  stepActionNames,
  stepFieldNames,
} from "@/features/flow-definitions/model";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { RevisionLink } from "@/features/schemas/components/revision-link";
import { schemaDisplayName } from "@/features/schemas/model";

export const Route = createFileRoute("/_authed/flow-definitions/$definitionId")({
  staticData: { scope: "project", resource: "login flow" },
  loaderDeps: projectScopeDeps,
  loader: async ({ params, deps }) => {
    const entry = await api.getFlowDefinition(params.definitionId);
    // Structurally the list's `flow_definition`; orval renames per operation.
    const definition: FlowDefinition = entry.flow_definition;
    return {
      definition,
      createdAt: entry.created_at,
      // No `expand` on this endpoint, so the badge costs a second call.
      ...(await resolveSchema(definition.user_schema, requireProjectScope(deps.project))),
    };
  },
  component: FlowDefinitionDetail,
});

/** The newest revision of the schema the flow names by `objectType`. */
async function resolveSchema(
  objectType: string | undefined,
  projectId: string,
): Promise<{ schemaName?: string; schemaId?: string }> {
  if (!objectType) return {};
  try {
    const page = await api.listSchemas({
      project_id: projectId,
      object_type: objectType,
      revisions: "latest",
      limit: 1,
    });
    const latest = page.schemas[0];
    if (!latest) return {};
    return { schemaName: schemaDisplayName(latest.schema, objectType), schemaId: latest.id };
  } catch {
    return {};
  }
}

function FlowDefinitionDetail() {
  const { definition, createdAt, schemaName, schemaId } = Route.useLoaderData();
  const { definitionId } = Route.useParams();
  const name = flowDisplayName(definition);
  const steps = definition.steps ?? [];

  return (
    <Page>
      <DetailHeader
        title={name}
        // The design draws a third value, `Expires at`; nothing backs it.
        meta={[
          { label: "Flow ID", value: definitionId, copyable: true },
          { label: "Created", value: formatDate(createdAt) },
        ]}
      />

      <DetailSection
        title="User schema"
        className={DETAIL_BODY}
        aside={
          schemaName && schemaId ? (
            // The name opens the schema; the box beside it opens the revision
            // the flow signs into, its newest.
            <span className="flex min-w-0 flex-wrap items-center gap-3">
              <Link
                to="/schemas/$schemaId"
                params={{ schemaId }}
                className="text-sm leading-5 text-foreground underline-offset-2 hover:underline"
              >
                {schemaName}
              </Link>
              <RevisionLink schemaId={schemaId} name={schemaName} />
            </span>
          ) : (
            definition.user_schema && (
              <span className="text-sm leading-5 text-foreground">{definition.user_schema}</span>
            )
          )
        }
      >
        {/* `table-fixed`: equal thirds, not redistributed by content. */}
        <Table className="table-fixed" aria-label="Steps">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={`${HEAD_CELL} pl-2`}>Step</TableHead>
              <TableHead className={HEAD_CELL}>Field</TableHead>
              <TableHead className={`${HEAD_CELL} pr-2`}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr:last-child]:border-b">
            {steps.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3} className="h-16 px-2 text-center text-muted-foreground">
                  This flow defines no steps.
                </TableCell>
              </TableRow>
            ) : (
              steps.map((step) => <StepRow key={step.name} step={step} />)
            )}
          </TableBody>
        </Table>

        <DocumentViewer document={definition} noun="definition" />
      </DetailSection>
    </Page>
  );
}

/** A terminal step collects and offers nothing, so both cells show an em dash. */
function StepRow({ step }: { step: FlowStep }) {
  const fields = stepFieldNames(step);
  const actions = stepActionNames(step);

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className={`${BODY_CELL} pl-2 text-foreground`}>{step.name}</TableCell>
      <TableCell className={`${BODY_CELL} text-muted-foreground`}>{fields || "—"}</TableCell>
      <TableCell className={`${BODY_CELL} pr-2 text-muted-foreground`}>{actions || "—"}</TableCell>
    </TableRow>
  );
}

const HEAD_CELL = PANEL_HEAD_CELL;
// `whitespace-normal`: a register step's field list outruns a third of the
// panel. `wrap-anywhere` as well: a field path like `x-auth-methods#password`
// has no break point, and on a phone a third of the panel is narrower than it.
const BODY_CELL = `${PANEL_BODY_CELL} whitespace-normal wrap-anywhere`;
