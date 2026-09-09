import { createFileRoute, Link } from "@tanstack/react-router";
import { Ellipsis, LogIn, Workflow } from "lucide-react";

import { EYEBROW } from "@/components/detail-meta";
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
  flowDisplayName,
  flowPurposeSummary,
  flowStepNames,
} from "@/lib/flow-definition";
import { schemaDisplayName } from "@/lib/schema";

import { api } from "../../../api/zitadel";
import { getConsoleProjectId } from "../../../runtime/runtime";

export const Route = createFileRoute("/_authed/flow-definitions/")({
  // Order 4: Users sits at 3, and the frame draws this row directly beneath it
  // (below the nested `User schemas` entry).
  staticData: { nav: { label: "Login flows", order: 4, icon: Workflow } },
  loader: async () => {
    // `expand=user_schema` embeds the schema document each definition operates
    // on, which is the only way the row can name it: the definition itself
    // carries the schema's id, and the row shows `Minimal`, not `sch_01KWH…`.
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
function toFlowRow(entry: {
  id: string;
  flow_definition: unknown;
  user_schema?: unknown;
  updated_at: string;
}): FlowRow {
  const definition = entry.flow_definition as FlowDefinition;
  // The embed is the same envelope `GET /schemas/{id}` returns — `{ id, schema,
  // metadata }` — so the displayable document is one level in. Reading the
  // envelope directly finds no `title` and silently falls back to the id.
  const embed = entry.user_schema as { schema?: Record<string, unknown> } | null | undefined;
  return {
    id: entry.id,
    definition,
    updatedAt: entry.updated_at,
    // `expand` returns `null` when the schema no longer resolves or the caller
    // may not read it, which is deliberately distinct from not asking. Either
    // way the row has no name to show, so it omits the column rather than
    // printing the raw id in a slot labelled `USER SCHEMA`.
    schemaName:
      embed?.schema && definition.user_schema
        ? schemaDisplayName(embed.schema, definition.user_schema)
        : undefined,
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

      {/* Rows run edge to edge and carry their own `px-6`, so the dividers
          between them are full-bleed. Same card as the user-schema directory. */}
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
 * Five columns — name over its purposes, the definition's step names as chips,
 * the user schema, the last change, and the row menu. The whole row is the
 * click target via a stretched link, so there is still exactly one focusable
 * control for the destination and middle-click still opens a tab; the menu
 * sits above that overlay.
 *
 * Below `lg` the columns stack. The MVP frame draws a narrow variant of the
 * screen but not of this row, so the stack is the console's reading of it.
 */
function FlowRowItem({ id, definition, updatedAt, schemaName, schemaId }: FlowRow) {
  const name = flowDisplayName(definition);
  const purposes = flowPurposeSummary(definition);
  const steps = flowStepNames(definition);

  return (
    <div className="group relative flex flex-col gap-4 border-b border-border px-6 py-3.5 last:border-b-0 hover:bg-accent lg:flex-row lg:items-center lg:gap-6">
      <div className="flex shrink-0 flex-col gap-1 lg:min-w-[220px]">
        <Link
          to="/flow-definitions/$definitionId"
          params={{ definitionId: id }}
          className="font-serif text-base leading-6 text-foreground opacity-90 group-hover:opacity-100 after:absolute after:inset-0 after:content-['']"
        >
          {name}
        </Link>
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

      {/* Stacked label over value, where `LAST CHANGE` puts the two on one
          line. The frame draws them differently because they read differently:
          this column is a name, that one is a date. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {schemaName && (
          <>
            <span className={EYEBROW}>User schema</span>
            {/* `relative z-10`, like the row menu: the name link sits under a
                stretched overlay covering the whole row, so a nested control has
                to be lifted above it or the row's own destination swallows the
                click. */}
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

      <dl className="flex shrink-0 items-start gap-1 text-xs leading-4">
        <dt className={EYEBROW}>Last change</dt>
        <dd className="font-medium text-foreground">{formatDate(updatedAt)}</dd>
      </dl>

      {/* Above the stretched link, or the row's own destination would swallow
          the menu's clicks. */}
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

/**
 * The chip lifts to `card` while its row is hovered.
 *
 * `InlineCode` rests on `muted` and the row's hover fill is `accent`, which in
 * the light theme is the same value — the same collision the schema directory
 * documents, and the same fix.
 */
const CHIP = "group-hover:bg-card";
