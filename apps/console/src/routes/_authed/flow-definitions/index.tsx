import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Ellipsis, Users, Workflow } from "lucide-react";

import { FigmaIcons } from "@/components/figma-icons";
import {
  RESOURCE_CELL,
  RESOURCE_TABLE_WRAP,
  ResourceHeadCell,
  opensRow,
} from "@/components/resource-list";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  type FlowDefinitionEntry,
  flowDisplayName,
  flowPurposeSummary,
} from "@/lib/flow-definition";
import { schemaDisplayName } from "@/lib/schema";

import { api } from "../../../api/zitadel";
import { projectScopeDeps, requireProjectScope } from "../../../lib/project-scope";

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

/** A cell's icon + text, 8px apart (the Figma cell's own gap). */
const ICON_CELL = "flex items-center gap-2 truncate";

/**
 * Login flows — the Figma `Flows directory` frame (1985:63295): a table rather
 * than the configuration-row card. A 64px page header (24px inset, 20px block),
 * then the resource table inset 16px — four equal columns (Name, Purpose, User
 * schema, Last change) and an 81px action column; the schema and date columns
 * are muted, headers included. The whole row opens the flow.
 */
function LoginFlowsScreen() {
  const { flows } = Route.useLoaderData();

  return (
    <>
      <div className="px-6 py-5">
        <h1 className="font-serif text-2xl leading-none text-foreground">Login flows</h1>
      </div>

      <div className="px-4 pb-8">
        <FigmaIcons>
          <div className={RESOURCE_TABLE_WRAP}>
            <Table className="table-fixed text-xs">
              <TableHeader>
                <TableRow className="border-border border-b hover:bg-transparent">
                  <ResourceHeadCell>Name</ResourceHeadCell>
                  <ResourceHeadCell>Purpose</ResourceHeadCell>
                  <ResourceHeadCell className="text-muted-foreground">User schema</ResourceHeadCell>
                  <ResourceHeadCell className="text-muted-foreground">Last change</ResourceHeadCell>
                  <TableHead className="h-14 w-[81px] px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {flows.length === 0 ? (
                  <TableRow className="border-0 hover:bg-transparent">
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      This project has no login flows.
                    </TableCell>
                  </TableRow>
                ) : (
                  flows.map((flow) => <FlowRowItem key={flow.id} {...flow} />)
                )}
              </TableBody>
            </Table>
          </div>
        </FigmaIcons>
      </div>
    </>
  );
}

function FlowRowItem({ id, definition, updatedAt, schemaName, schemaId }: FlowRow) {
  const navigate = useNavigate();
  const name = flowDisplayName(definition);

  return (
    <TableRow
      className="hover:bg-muted/40 cursor-pointer border-0"
      onClick={(event) => {
        if (opensRow(event)) {
          void navigate({ to: "/flow-definitions/$definitionId", params: { definitionId: id } });
        }
      }}
    >
      <TableCell className={RESOURCE_CELL}>
        <div className={ICON_CELL}>
          <Link
            to="/flow-definitions/$definitionId"
            params={{ definitionId: id }}
            className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-foreground underline-offset-2 hover:underline"
          >
            <Workflow size={16} className="shrink-0" aria-hidden />
            <span className="truncate">{name}</span>
          </Link>
          {/* Only a draft is badged; active is the default. */}
          {definition.status === "draft" && <StatusBadge status={definition.status} />}
        </div>
      </TableCell>
      <TableCell className={`${RESOURCE_CELL} truncate text-sm text-foreground`}>
        {flowPurposeSummary(definition) || "—"}
      </TableCell>
      <TableCell className={`${RESOURCE_CELL} text-sm text-muted-foreground`}>
        {schemaName && schemaId ? (
          <Link
            to="/schemas/$schemaId"
            params={{ schemaId }}
            className={`${ICON_CELL} underline-offset-2 hover:underline`}
          >
            <Users size={16} className="shrink-0" aria-hidden />
            <span className="truncate">{schemaName}</span>
          </Link>
        ) : schemaName ? (
          <span className={ICON_CELL}>
            <Users size={16} className="shrink-0" aria-hidden />
            <span className="truncate">{schemaName}</span>
          </span>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className={`${RESOURCE_CELL} truncate text-sm text-muted-foreground`}>
        {formatDate(updatedAt)}
      </TableCell>
      <TableCell className={`${RESOURCE_CELL} text-right`}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${name}`}>
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem asChild>
              <Link to="/flow-definitions/$definitionId" params={{ definitionId: id }}>
                View flow
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
