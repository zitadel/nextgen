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
    // Structurally the list's `flow_definition`; orval just names it once per
    // operation.
    const definition: FlowDefinition = entry.flow_definition;
    return {
      definition,
      createdAt: entry.created_at,
      // `getFlowDefinition` takes no `expand`, unlike the list, so the schema
      // behind the header badge costs a second call. It is decoration on a
      // screen that is already useful without it, so a schema the caller
      // cannot read drops the badge rather than failing the route.
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
        {/* Title lockup and the identity card sit on one row above the rule;
            they stack below `lg`, where the frame's narrow variant puts the
            card under the title. */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* The badge sits beside the title when there is room and drops to
              its own line below it otherwise, which is what the frame's narrow
              variant draws — and what keeps a long schema name from squeezing
              the title down to an ellipsis. It aligns with the icon tile, not
              with the title, in that stacked state. */}
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
            {/* The schema the flow operates on, as the frame's outline badge.
                `Link2` is the frame's glyph: the badge is a reference to
                another resource, not a status. */}
            {schemaName && schemaId && (
              <Link to="/schemas/$schemaId" params={{ schemaId }} className="w-fit shrink-0">
                <Badge variant="outline" className="h-5 gap-1 hover:bg-accent">
                  <Link2 className="size-3" aria-hidden />
                  {schemaName}
                </Badge>
              </Link>
            )}
          </div>

          {/* The design draws `EXPIRES AT` as a third value here. Nothing on a
              flow definition expires — the response carries only `created_at`
              and `updated_at` — so the card ships with two. */}
          <Card className="gap-0 rounded-md py-0 shadow-xs">
            <CardContent className="flex flex-col px-5 py-3.5 sm:flex-row sm:flex-wrap sm:items-start">
              <MetaValue label="Flow ID" value={definitionId} copyable />
              <MetaRule />
              <MetaValue label="Created" value={formatDate(createdAt)} />
            </CardContent>
          </Card>
        </div>

        <Separator />

        {/* No inset: the frame lines `STEPS` up with the title's icon tile, so
            the section starts at the card's own content edge. (The schema
            detail insets its equivalent by 8px because a tab strip sits above
            it and the inset aligns with the tab *label*; there are no tabs
            here.) */}
        <section className="flex flex-col gap-3">
          <h2 className={EYEBROW}>Steps</h2>
          {/* `table-fixed`: the frame gives the three columns an equal third
              each, which auto layout would otherwise redistribute towards
              whichever step happens to collect the most fields. */}
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

/**
 * One step row.
 *
 * A terminal step collects nothing and offers nothing, so both cells fall back
 * to an em dash — the frame's own treatment for the `passkey-upsell` row, and
 * better than two empty cells that read as a rendering fault.
 */
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

// The display face, uppercase 12px with 0.72px tracking — the same column
// treatment the schema field table gives its headers.
const HEAD_CELL =
  "h-auto px-0 py-3 font-serif text-xs font-normal tracking-[0.72px] text-muted-foreground uppercase";
// `whitespace-normal` because a register step's field list is longer than a
// third of the panel, and truncating it hides the fields the row exists to name.
const BODY_CELL = "px-0 py-3 text-sm whitespace-normal";
