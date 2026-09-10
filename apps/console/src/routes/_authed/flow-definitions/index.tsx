import { createFileRoute, Link } from "@tanstack/react-router";
import { Ellipsis, LogIn, Workflow } from "lucide-react";

import { EYEBROW } from "@/components/detail-meta";
import { StatusBadge } from "@/components/status-badge";
import { RESOURCE_HEADER, RESOURCE_PAGE } from "@/components/resource-list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InlineCode } from "@/components/ui/inline-code";
import { formatDate } from "@/lib/date";
import {
  type FlowDefinition,
  type FlowDefinitionEntry,
  flowDisplayName,
  flowPurposeSummary,
  flowStepNames,
} from "@/lib/flow-definition";
import { schemaDisplayName } from "@/lib/schema";

import { api } from "../../../api/zitadel";
import { getConsoleProjectId } from "../../../runtime/runtime";

export const Route = createFileRoute("/_authed/flow-definitions/")({
  // Order 4: Users sits at 3.
  staticData: { nav: { label: "Login flows", order: 4, icon: Workflow } },
  loader: async () => {
    // Without the embed the row has only the schema's id, not its name.
    const page = await api.listFlowDefinitions({
      project_id: getConsoleProjectId(),
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
    <div className={`${RESOURCE_PAGE} pt-4`}>
      <div className={`${RESOURCE_HEADER} flex h-9 items-center`}>
        <h1 className="font-serif text-2xl leading-6 tracking-tight text-foreground">
          Login flows
        </h1>
      </div>

      {/* Rows carry their own `px-6`, so the dividers are full-bleed. */}
      <Card className="mt-3 gap-0 overflow-hidden border-foreground/10 py-0 shadow-xs">
        {flows.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            This project has no login flows.
          </p>
        ) : (
          flows.map((flow) => <FlowRowItem key={flow.id} {...flow} />)
        )}
      </Card>
    </div>
  );
}

/**
 * One row of the flows directory.
 *
 * The name's stretched link makes the whole row the click target while keeping
 * one focusable control, so anything else interactive has to sit above it.
 */
function FlowRowItem({ id, definition, updatedAt, schemaName, schemaId }: FlowRow) {
  const name = flowDisplayName(definition);
  const purposes = flowPurposeSummary(definition);
  const steps = flowStepNames(definition);

  return (
    <div className="group relative flex flex-col gap-4 border-b border-border px-6 py-3.5 last:border-b-0 hover:bg-accent lg:flex-row lg:items-center lg:gap-6">
      <div className="flex shrink-0 flex-col gap-1 lg:min-w-[220px]">
        <div className="flex items-center gap-2">
          <Link
            to="/flow-definitions/$definitionId"
            params={{ definitionId: id }}
            className="font-serif text-base leading-6 text-foreground opacity-90 group-hover:opacity-100 after:absolute after:inset-0 after:content-['']"
          >
            {name}
          </Link>
          {/* Drafts only: the engine never selects one, and the frames draw
              only active flows. */}
          {definition.status === "draft" && <StatusBadge status={definition.status} />}
        </div>
        {purposes && (
          <span className="flex items-center gap-1 text-xs leading-4 font-medium text-muted-foreground">
            <LogIn className="size-3" aria-hidden />
            {purposes}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-1.5">
        {steps.map((step) => (
          <InlineCode key={step} className={CHIP}>
            {step}
          </InlineCode>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {schemaName && (
          <>
            <span className={EYEBROW}>User schema</span>
            {/* Above the row's stretched link, or it swallows the click. */}
            {schemaId ? (
              <Link
                to="/schemas/$schemaId"
                params={{ schemaId }}
                className="relative z-10 w-fit truncate text-xs leading-4 font-medium text-foreground hover:underline"
              >
                {schemaName}
              </Link>
            ) : (
              <span className="truncate text-xs leading-4 font-medium text-foreground">
                {schemaName}
              </span>
            )}
          </>
        )}
      </div>

      {/* Baseline, not `items-start`: two faces sit differently in one line box. */}
      <dl className="flex shrink-0 items-baseline gap-1 text-xs leading-4">
        <dt className={EYEBROW}>Last change</dt>
        <dd className="font-medium text-foreground">{formatDate(updatedAt)}</dd>
      </dl>

      {/* Above the stretched link, or it swallows the menu's clicks. */}
      <div className="absolute top-3.5 right-4 lg:relative lg:top-auto lg:right-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${name}`}
              className="relative z-10 opacity-50 group-hover:opacity-100"
            >
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
      </div>
    </div>
  );
}

/** `InlineCode` rests on `muted`, which equals the row's `accent` hover in light. */
const CHIP = "group-hover:bg-card";
