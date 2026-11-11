import { Link } from "@tanstack/react-router";
import { Link2, Workflow } from "lucide-react";

import { MetaCard, MetaRule, MetaValue } from "@/components/detail-meta";
import { DetailPanel, PanelTitle } from "@/components/detail-page";
import { DocumentViewer } from "@/components/document-viewer";
import { Page } from "@/components/layout";
import { PANEL_BODY_CELL, PANEL_HEAD_CELL, SECTION_HEADING } from "@/components/typography";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FlowDefinitionData } from "@/features/flow-definitions/load";
import {
  type FlowStep,
  flowDisplayName,
  stepActionNames,
  stepFieldNames,
} from "@/features/flow-definitions/model";
import { formatDate } from "@/lib/date";

export interface FlowDefinitionScreenProps extends FlowDefinitionData {
  /** The definition's id, from the route's params. */
  definitionId: string;
  /**
   * The route the schema badge links to. Left out at the root, which shows no
   * schemas (D41): the badge then names the schema without linking it.
   */
  schemaTo?: "/schemas/$schemaId";
}

/**
 * One flow definition: its steps and its document. Drawn for the selected
 * project's flows, and at the root for the reserved platform project's (D41).
 */
export function FlowDefinitionScreen({
  definitionId,
  definition,
  createdAt,
  schemaName,
  schemaId,
  schemaTo,
}: FlowDefinitionScreenProps) {
  const name = flowDisplayName(definition);
  const steps = definition.steps ?? [];

  return (
    <Page inset="panel">
      <DetailPanel>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Stacks below `sm` so a long schema name cannot squeeze the title. */}
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <PanelTitle icon={Workflow} title={name} />
            {schemaName &&
              schemaId &&
              (schemaTo ? (
                <Link to={schemaTo} params={{ schemaId }} className="w-fit shrink-0">
                  <Badge variant="outline" className="h-5 gap-1 hover:bg-accent">
                    <Link2 className="size-3" aria-hidden />
                    {schemaName}
                  </Badge>
                </Link>
              ) : (
                <Badge variant="outline" className="h-5 w-fit shrink-0 gap-1">
                  <Link2 className="size-3" aria-hidden />
                  {schemaName}
                </Badge>
              ))}
          </div>

          {/* The design draws a third value, `EXPIRES AT`; nothing backs it. */}
          <MetaCard bordered={false}>
            <MetaValue label="Flow ID" value={definitionId} copyable />
            <MetaRule />
            <MetaValue label="Created" value={formatDate(createdAt)} />
          </MetaCard>
        </div>

        <Separator />

        {/* No inset: "Steps" lines up with the icon tile. (The schema detail
            insets its equivalent to clear a tab strip; there are none here.) */}
        <section className="flex flex-col gap-3">
          <h2 className={SECTION_HEADING}>Steps</h2>
          {/* `table-fixed`: equal thirds, not redistributed by content. */}
          <Table className="table-fixed">
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
        </section>

        <DocumentViewer document={definition} noun="definition" />
      </DetailPanel>
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
