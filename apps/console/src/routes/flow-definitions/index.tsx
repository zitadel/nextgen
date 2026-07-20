import { createFileRoute } from "@tanstack/react-router";
import { Pill } from "@zitadel/ui-react";

import { api, projectId } from "../../api/zitadel";
import { ContentGrid, Page } from "../../components/layout";
import { DataTable, PageHeader, TableLink } from "../../components/resource-page";

export const Route = createFileRoute("/flow-definitions/")({
  loader: () => api.listFlowDefinitions({ project_id: projectId }),
  component: FlowDefinitionsList,
});

function FlowDefinitionsList() {
  const { flow_definitions: definitions } = Route.useLoaderData();
  const active = definitions.filter((definition) => definition.status === "active").length;

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
                {definition.name}
              </TableLink>
            ),
          },
          {
            header: "Status",
            cell: (definition) => (
              <Pill tone={definition.status === "active" ? "success" : "neutral"}>{definition.status}</Pill>
            ),
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
    <div className={`rounded-zl-l border border-zl-border-subtle bg-zl-surface-raised p-5 ${className}`}>
      <p className="text-2xl font-semibold text-zl-text-primary">{value.toLocaleString()}</p>
      <p className="mt-1 text-sm text-zl-text-secondary">{label}</p>
    </div>
  );
}
