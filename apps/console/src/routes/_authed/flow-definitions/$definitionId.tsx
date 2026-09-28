import { createFileRoute, Link } from "@tanstack/react-router";
import { Link2, Workflow } from "lucide-react";

import { DocumentViewer } from "@/components/document-viewer";
import { DETAIL_PANEL_PAGE } from "@/components/layout";
import { EYEBROW, MetaRule, MetaValue } from "@/components/detail-meta";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
} from "@/lib/flow-definition";
import { schemaDisplayName } from "@/lib/schema";

import { api } from "../../../api/zitadel";

export const Route = createFileRoute("/_authed/flow-definitions/$definitionId")({
  loader: async ({ params }) => {
    const entry = await api.getFlowDefinition(params.definitionId);
    // Structurally the list's `flow_definition`; orval renames per operation.
    const definition: FlowDefinition = entry.flow_definition;
    return {
      definition,
      createdAt: entry.created_at,
      // No `expand` on this endpoint, so the badge costs a second call.
      schemaName: await resolveSchemaName(definition.user_schema),
      schemaId: definition.user_schema,
    };
  },
  component: FlowDefinitionDetail,
});

async function resolveSchemaName(id: string | undefined): Promise<string | undefined> {
  if (!id) return undefined;
  try {
    const body = await api.getSchemaById(id);
    return schemaDisplayName(body.schema, id);
  } catch {
    return undefined;
  }
}

function FlowDefinitionDetail() {
  const { definition, createdAt, schemaName, schemaId } = Route.useLoaderData();
  const { definitionId } = Route.useParams();
  const name = flowDisplayName(definition);
  const steps = definition.steps ?? [];

  return (
    <div className={DETAIL_PANEL_PAGE}>
      <Card className="gap-4 border-foreground/10 px-6 py-5 shadow-xs">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Stacks below `sm` so a long schema name cannot squeeze the title. */}
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"
              >
                <Workflow className="size-4 text-foreground" />
              </span>
              <h1 className="truncate font-serif text-lg leading-6 text-foreground">{name}</h1>
            </div>
            {schemaName && schemaId && (
              <Link to="/schemas/$schemaId" params={{ schemaId }} className="w-fit shrink-0">
                <Badge variant="outline" className="h-5 gap-1 hover:bg-accent">
                  <Link2 className="size-3" aria-hidden />
                  {schemaName}
                </Badge>
              </Link>
            )}
          </div>

          {/* The frame draws a third value, `EXPIRES AT`; nothing backs it. */}
          <Card className="gap-0 rounded-md py-0 shadow-xs">
            <CardContent className="flex flex-col px-5 py-3.5 sm:flex-row sm:flex-wrap sm:items-start">
              <MetaValue label="Flow ID" value={definitionId} copyable />
              <MetaRule />
              <MetaValue label="Created" value={formatDate(createdAt)} />
            </CardContent>
          </Card>
        </div>

        <Separator />

        {/* No inset: `STEPS` lines up with the icon tile. (The schema detail
            insets its equivalent to clear a tab strip; there are none here.) */}
        <section className="flex flex-col gap-3">
          <h2 className={EYEBROW}>Steps</h2>
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
      </Card>
    </div>
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

const HEAD_CELL =
  "h-auto px-0 py-3 font-serif text-xs font-normal tracking-[0.72px] text-muted-foreground uppercase";
// `whitespace-normal`: a register step's field list outruns a third of the panel.
const BODY_CELL = "px-0 py-3 text-sm whitespace-normal";
