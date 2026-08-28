import { createFileRoute } from "@tanstack/react-router";
import type { ListFlowDefinitions200 } from "@zitadel/api/generated/model";

import { StatusBadge } from "@/components/status-badge";
import { type UserSchema, schemaDisplayName } from "@/lib/schema";

import { api } from "../../../api/zitadel";
import { getConsoleProjectId } from "../../../runtime/runtime";
import { ContentGrid, Page } from "../../../components/layout";
import { DataTable, PageHeader, TableLink } from "../../../components/resource-page";

export const Route = createFileRoute("/_authed/flow-definitions/")({
  loader: async () => {
    const projectId = getConsoleProjectId();
    const { flow_definitions: definitions } = await api.listFlowDefinitions({
      project_id: projectId,
    });
    return { definitions, schemaNames: await schemaNames(projectId, definitions) };
  },
  component: FlowDefinitionsList,
});

/**
 * Display names for the schemas the listed flows pin, keyed by id.
 *
 * Fetched by id, and only the referenced ones: a flow keeps the schema revision
 * it was created with, so a `revisions: latest` list would miss every flow
 * pointing at a superseded one. The ids come from the flow list, which is why
 * this runs after it rather than alongside it.
 *
 * Best-effort — an id the response does not carry (a deleted schema) or a
 * failed list leaves the row labelled with the id itself, which is still true.
 */
async function schemaNames(
  projectId: string,
  definitions: ListFlowDefinitions200["flow_definitions"],
): Promise<Map<string, string>> {
  const ids = [...new Set(definitions.map((definition) => definition.flow_definition.user_schema))];
  if (ids.length === 0) return new Map();
  const listed = await api.listSchemas({ project_id: projectId, id: ids }).catch(() => undefined);
  return new Map(
    listed?.schemas.map((entry) => [
      entry.id,
      schemaDisplayName(entry.schema as UserSchema, entry.id),
    ]),
  );
}

function FlowDefinitionsList() {
  const { definitions, schemaNames } = Route.useLoaderData();
  const active = definitions.filter(
    (definition) => definition.flow_definition.status === "active",
  ).length;

  return (
    <Page>
      {/* action / tabs parked: the create button is a disabled stub and the tab
          strip is non-functional hardcoded chrome. Restore when create flows and
          sub-view navigation are wired. */}
      <PageHeader
        title="Login flows"
        description="Flow definitions that drive your login journeys. Push changes via the CLI."
      />

      <ContentGrid className="mb-6">
        <SummaryCard className="md:col-span-4" label="Flow definitions" value={definitions.length} />
        <SummaryCard className="md:col-span-4" label="Active" value={active} />
        <SummaryCard className="md:col-span-4" label="Inactive" value={definitions.length - active} />
      </ContentGrid>

      <DataTable
        rows={definitions}
        getRowKey={(definition) => definition.id}
        emptyMessage="No flow definitions yet."
        columns={[
          {
            header: "Name",
            cell: (definition) => (
              <TableLink to="/flow-definitions/$definitionId" params={{ definitionId: definition.id }}>
                {definition.flow_definition.name}
              </TableLink>
            ),
          },
          {
            header: "User schema",
            cell: (definition) => {
              const id = definition.flow_definition.user_schema;
              // An unresolved schema shows its id rather than an empty cell —
              // mono and muted so it reads as an identifier, not a name.
              return (
                schemaNames.get(id) ?? (
                  <span className="font-mono text-xs text-muted-foreground">{id}</span>
                )
              );
            },
          },
          {
            header: "Status",
            cell: (definition) => <StatusBadge status={definition.flow_definition.status} />,
          },
          { header: "Created", cell: (definition) => definition.created_at },
        ]}
      />
    </Page>
  );
}

function SummaryCard({
  label,
  value,
  className = "",
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-card p-5 ${className}`}>
      <p className="text-2xl font-semibold text-foreground">{value.toLocaleString()}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
