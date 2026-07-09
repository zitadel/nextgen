import { createFileRoute } from "@tanstack/react-router";
import { Pill } from "@zitadel/ui-react";

import { api, projectId } from "../../api/zitadel";
import {
  CreateButtonStub,
  DataTable,
  PageHeader,
  TableLink,
} from "../../components/resource-page";

export const Route = createFileRoute("/flow-definitions/")({
  staticData: { nav: { group: "Configuration", label: "Flow Definitions", order: 2 } },
  loader: () => api.listFlowDefinitions({ project_id: projectId }),
  component: FlowDefinitionsList,
});

function FlowDefinitionsList() {
  const { flow_definitions: definitions } = Route.useLoaderData();

  return (
    <>
      <PageHeader
        title="Flow Definitions"
        action={<CreateButtonStub label="Create flow definition" />}
      />
      <DataTable
        rows={definitions}
        getRowKey={(definition) => definition.id}
        emptyMessage="No flow definitions yet."
        columns={[
          {
            header: "Name",
            cell: (definition) => (
              <TableLink
                to="/flow-definitions/$definitionId"
                params={{ definitionId: definition.id }}
              >
                {definition.name}
              </TableLink>
            ),
          },
          {
            header: "Status",
            cell: (definition) => (
              <Pill tone={definition.status === "active" ? "success" : "neutral"}>
                {definition.status}
              </Pill>
            ),
          },
          { header: "Created", cell: (definition) => definition.created_at },
        ]}
      />
    </>
  );
}
