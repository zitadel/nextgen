import { createFileRoute } from "@tanstack/react-router";

import { StatusBadge } from "@/components/status-badge";

import { api } from "../../../api/zitadel";
import { getConsoleProjectId } from "../../../runtime/runtime";
import { ContentGrid, Page } from "../../../components/layout";
import { DataTable, PageHeader, TableLink } from "../../../components/resource-page";

export const Route = createFileRoute("/_authed/flow-definitions/")({
  loader: () => api.listFlowDefinitions({ project_id: getConsoleProjectId() }),
  component: FlowDefinitionsList,
});

function FlowDefinitionsList() {
  const { flow_definitions: definitions } = Route.useLoaderData();
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
