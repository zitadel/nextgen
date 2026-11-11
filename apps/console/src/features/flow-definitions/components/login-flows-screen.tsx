import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Workflow } from "lucide-react";

import { CLI_DEPLOY, CliCommand, CliHint } from "@/components/cli-hint";
import { Page } from "@/components/layout";
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
  ResourceRow,
  ResourceTitle,
  RowMenu,
} from "@/components/resource-list";
import { StatusBadge } from "@/components/status-badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { InlineCode } from "@/components/ui/inline-code";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import type { FlowRow, LoginFlowsData } from "@/features/flow-definitions/load";
import {
  flowDisplayName,
  flowPurposeSummary,
  flowStepNames,
} from "@/features/flow-definitions/model";
import { formatDate } from "@/lib/date";

/** Where the screen's links lead, which differs between the project and the root. */
export interface LoginFlowsLinks {
  /** The route a row opens: the project's flow detail, or the root's (D41). */
  detailTo: "/flow-definitions/$definitionId" | "/platform/login-flows/$definitionId";
  /**
   * The route the user-schema cell links to. Left out at the root, which
   * shows no schemas (D41): the cell then names the schema as text.
   */
  schemaTo?: "/schemas/$schemaId";
  /**
   * The line beneath the table. Left out, it says to deploy edits with the
   * CLI; the root says instead that the server deploys the platform's flows
   * at every start (`internal/bootstrap/platform`), which a deploy of one's
   * own would not outlast.
   */
  hint?: ReactNode;
  /** What an empty list says, where it is not a project's (the root's, D41). */
  empty?: string;
}

/**
 * The Login flows list: every flow of a project at its latest revision. Drawn
 * for the selected project, and at the root for the reserved platform project
 * (D41), where its flows are how people sign in to the console.
 */
export function LoginFlowsScreen({
  flows,
  hint,
  empty = "This project has no login flows.",
  ...links
}: LoginFlowsData & LoginFlowsLinks) {
  return (
    <Page>
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
              <ResourceEmptyRow colSpan={6}>{empty}</ResourceEmptyRow>
            ) : (
              flows.map((flow) => <FlowRowItem key={flow.id} {...flow} {...links} />)
            )}
          </TableBody>
        </Table>
        <CliHint>
          {hint ?? (
            <>
              Edit the definitions locally, then deploy your changes with{" "}
              <CliCommand>{CLI_DEPLOY}</CliCommand>.
            </>
          )}
        </CliHint>
      </div>
    </Page>
  );
}

/** One row of the flows directory. The whole row opens the flow. */
function FlowRowItem({
  id,
  definition,
  updatedAt,
  schemaName,
  schemaId,
  detailTo,
  schemaTo,
}: FlowRow & LoginFlowsLinks) {
  const navigate = useNavigate();
  const name = flowDisplayName(definition);
  const purposes = flowPurposeSummary(definition);
  const steps = flowStepNames(definition);

  return (
    <ResourceRow onOpen={() => void navigate({ to: detailTo, params: { definitionId: id } })}>
      <TableCell className={`${RESOURCE_CELL} truncate`}>
        <div className="flex min-w-0 items-center gap-2">
          <Link to={detailTo} params={{ definitionId: id }} className={RESOURCE_ROW_LINK}>
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
          (schemaId && schemaTo ? (
            <Link
              to={schemaTo}
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
            <Link to={detailTo} params={{ definitionId: id }}>
              View flow
            </Link>
          </DropdownMenuItem>
        </RowMenu>
      </TableCell>
    </ResourceRow>
  );
}
