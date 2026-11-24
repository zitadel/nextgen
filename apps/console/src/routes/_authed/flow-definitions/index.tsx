import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Workflow } from "lucide-react";

import { api } from "@/api/zitadel";
import {
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_ROW_ICON,
  RESOURCE_ROW_LINK,
  RESOURCE_TABLE_FIXED,
  RESOURCE_TABLE_TOP,
  RESOURCE_TABLE_WRAP,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceMenuHead,
  ResourceRow,
  ResourceTitle,
  RowMenu,
} from "@/components/resource-list";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { CLI_DEPLOY, CliCommand } from "@/components/cli-hint";
import { ResourceEmpty } from "@/components/resource-empty";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { formatDate } from "@/lib/date";
import {
  type FlowDefinition,
  type FlowDefinitionEntry,
  flowDisplayName,
  flowPurposeSummary,
} from "@/features/flow-definitions/model";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { schemaDisplayName } from "@/features/schemas/model";
import { Page } from "@/components/layout";
import { DOCS_URL } from "@/lib/docs";

export const Route = createFileRoute("/_authed/flow-definitions/")({
  // Order 5: Users sits at 3, Authentication at 4.
  staticData: { scope: "project", nav: { label: "Login flows", order: 5, icon: Workflow } },
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }) => {
    // Without the embed the row has only the schema's objectType.
    // `latest` because this is a directory of flows, not a revision history:
    // publishing under an existing name generates a new row, and only the newest
    // one is the flow.
    const page = await api.listFlowDefinitions({
      project_id: requireProjectScope(deps.project),
      revisions: "latest",
      expand: ["user_schema"],
    });
    return { flows: page.flow_definitions.map(toFlowRow) };
  },
  component: LoginFlowsScreen,
});

/** Exported because the generated route tree names it in the loader's type. */
export interface FlowRow {
  id: string;
  definition: FlowDefinition;
  updatedAt: string;
  /** `undefined` when the schema does not resolve for this caller. */
  schemaName: string | undefined;
  /** The revision behind {@link schemaName}, for the row's link to the schema. */
  schemaId: string | undefined;
}

// Mapped rather than spread so the wire's snake_case stops at the loader.
function toFlowRow(entry: FlowDefinitionEntry): FlowRow {
  const definition = entry.flow_definition;
  // The embed is the `GET /schemas/{schema_id}` envelope, so the document is one level in.
  const embed = entry.user_schema;
  return {
    id: entry.id,
    definition,
    updatedAt: entry.updated_at,
    schemaName: embed ? schemaDisplayName(embed.schema, definition.user_schema) : undefined,
    schemaId: embed?.id,
  };
}

function LoginFlowsScreen() {
  const { flows } = Route.useLoaderData();

  return (
    <Page>
      <ResourceTitle>Login flows</ResourceTitle>

      <div className={RESOURCE_TABLE_TOP}>
        {flows.length === 0 ? (
          <ResourceEmpty
            icon={Workflow}
            title="No login flows yet"
            docsHref={`${DOCS_URL}/guides/edit-login-flow`}
          >
            Create a login flow locally, then deploy it with{" "}
            <span className="whitespace-nowrap">
              <CliCommand>{CLI_DEPLOY}</CliCommand>.
            </span>
          </ResourceEmpty>
        ) : (
          // The same resource table as the other directories (D17): four
          // equal data columns and the row menu.
          <div className={RESOURCE_TABLE_WRAP}>
            <Table className={RESOURCE_TABLE_FIXED}>
              <TableHeader>
                <ResourceHeaderRow>
                  <ResourceHeadCell>Name</ResourceHeadCell>
                  <ResourceHeadCell>Purpose</ResourceHeadCell>
                  <ResourceHeadCell>User schema</ResourceHeadCell>
                  <ResourceHeadCell>Last change</ResourceHeadCell>
                  <ResourceMenuHead className="w-20" />
                </ResourceHeaderRow>
              </TableHeader>
              <TableBody>
                {flows.map((flow) => (
                  <FlowRowItem key={flow.id} {...flow} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Page>
  );
}

/** One row of the flows directory. The whole row opens the flow. */
function FlowRowItem({ id, definition, updatedAt, schemaName, schemaId }: FlowRow) {
  const navigate = useNavigate();
  const name = flowDisplayName(definition);
  const purposes = flowPurposeSummary(definition);

  return (
    <ResourceRow
      onOpen={() =>
        void navigate({ to: "/flow-definitions/$definitionId", params: { definitionId: id } })
      }
    >
      <TableCell className={`${RESOURCE_CELL} truncate`}>
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to="/flow-definitions/$definitionId"
            params={{ definitionId: id }}
            className={RESOURCE_ROW_LINK}
          >
            <Workflow aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
            {name}
          </Link>
        </div>
      </TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>{purposes}</TableCell>
      <TableCell className={`${RESOURCE_CELL} truncate text-sm`}>
        {schemaName &&
          (schemaId ? (
            <Link
              to="/schemas/$schemaId"
              params={{ schemaId }}
              className="text-foreground font-medium underline-offset-2 hover:underline"
            >
              {schemaName}
            </Link>
          ) : (
            <span className="text-foreground font-medium">{schemaName}</span>
          ))}
      </TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>{formatDate(updatedAt)}</TableCell>
      <TableCell className={`${RESOURCE_CELL} text-right`}>
        <RowMenu name={name}>
          <DropdownMenuItem asChild>
            <Link to="/flow-definitions/$definitionId" params={{ definitionId: id }}>
              View flow
            </Link>
          </DropdownMenuItem>
        </RowMenu>
      </TableCell>
    </ResourceRow>
  );
}
