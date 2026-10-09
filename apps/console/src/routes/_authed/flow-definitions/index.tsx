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
  ResourceEmptyRow,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceMenuHead,
  ResourcePage,
  ResourceRow,
  ResourceTitle,
  RowMenu,
} from "@/components/resource-list";
import { StatusBadge } from "@/components/status-badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { InlineCode } from "@/components/ui/inline-code";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { formatDate } from "@/lib/date";
import {
  type FlowDefinition,
  type FlowDefinitionEntry,
  flowDisplayName,
  flowPurposeSummary,
  flowStepNames,
} from "@/lib/flow-definition";
import { projectScopeDeps, requireProjectScope } from "@/lib/project-scope";
import { schemaDisplayName } from "@/lib/schema";

export const Route = createFileRoute("/_authed/flow-definitions/")({
  // Order 4: Users sits at 3.
  staticData: { scope: "project", nav: { label: "Login flows", order: 4, icon: Workflow } },
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }) => {
    // Without the embed the row has only the schema's id, not its name.
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
  /** The id behind {@link schemaName}, for the row's link to the schema. */
  schemaId: string | undefined;
}

// Mapped rather than spread so the wire's snake_case stops at the loader.
function toFlowRow(entry: FlowDefinitionEntry): FlowRow {
  const definition = entry.flow_definition;
  // The embed is the `GET /schemas/{id}` envelope, so the document is one level in.
  const embed = entry.user_schema;
  return {
    id: entry.id,
    definition,
    updatedAt: entry.updated_at,
    schemaName: embed ? schemaDisplayName(embed.schema, definition.user_schema) : undefined,
    schemaId: definition.user_schema,
  };
}

function LoginFlowsScreen() {
  const { flows } = Route.useLoaderData();

  return (
    <ResourcePage>
      <ResourceTitle>Login flows</ResourceTitle>

      <div className={`${RESOURCE_TABLE_WRAP} ${RESOURCE_TABLE_TOP}`}>
        {/* The same resource table as the other directories (D17). Six columns
            need more room than four, so the table's own minimum width is wider
            than the shared one; the step chips wrap within their column, so a
            flow with many steps grows its row rather than the table. */}
        <Table className={`${RESOURCE_TABLE_FIXED} min-w-[52rem]`}>
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell className="w-[20%]">Name</ResourceHeadCell>
              <ResourceHeadCell className="w-[16%]">Purposes</ResourceHeadCell>
              <ResourceHeadCell className="w-[30%]">Steps</ResourceHeadCell>
              <ResourceHeadCell className="w-[14%]">User schema</ResourceHeadCell>
              <ResourceHeadCell className="w-[11%]">Last change</ResourceHeadCell>
              <ResourceMenuHead className="w-[9%]" />
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {flows.length === 0 ? (
              <ResourceEmptyRow colSpan={6}>This project has no login flows.</ResourceEmptyRow>
            ) : (
              flows.map((flow) => <FlowRowItem key={flow.id} {...flow} />)
            )}
          </TableBody>
        </Table>
      </div>
    </ResourcePage>
  );
}

/** One row of the flows directory. The whole row opens the flow. */
function FlowRowItem({ id, definition, updatedAt, schemaName, schemaId }: FlowRow) {
  const navigate = useNavigate();
  const name = flowDisplayName(definition);
  const purposes = flowPurposeSummary(definition);
  const steps = flowStepNames(definition);

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
          {/* Drafts only: the engine never selects one, and the design draws
              only active flows. */}
          {definition.status === "draft" && <StatusBadge status={definition.status} />}
        </div>
      </TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>{purposes}</TableCell>
      <TableCell className={RESOURCE_CELL}>
        <div className="flex flex-wrap gap-1.5">
          {steps.map((step) => (
            <InlineCode key={step}>{step}</InlineCode>
          ))}
        </div>
      </TableCell>
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
