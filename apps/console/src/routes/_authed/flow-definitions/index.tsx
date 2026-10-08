import { createFileRoute, Link } from "@tanstack/react-router";
import { LogIn, Workflow } from "lucide-react";

import { api } from "@/api/zitadel";
import { EYEBROW } from "@/components/typography";
import {
  DIRECTORY_CHIP,
  DIRECTORY_ROW_LINK,
  DirectoryCard,
  DirectoryRow,
} from "@/components/directory-list";
import { ResourcePage, ResourceTitle } from "@/components/resource-list";
import { StatusBadge } from "@/components/status-badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { InlineCode } from "@/components/ui/inline-code";
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

      <DirectoryCard empty={flows.length === 0 ? "This project has no login flows." : undefined}>
        {flows.map((flow) => (
          <FlowRowItem key={flow.id} {...flow} />
        ))}
      </DirectoryCard>
    </ResourcePage>
  );
}

/** One row of the flows directory. */
function FlowRowItem({ id, definition, updatedAt, schemaName, schemaId }: FlowRow) {
  const name = flowDisplayName(definition);
  const purposes = flowPurposeSummary(definition);
  const steps = flowStepNames(definition);

  return (
    <DirectoryRow
      name={name}
      title={
        <div className="flex items-center gap-2">
          <Link
            to="/flow-definitions/$definitionId"
            params={{ definitionId: id }}
            className={DIRECTORY_ROW_LINK}
          >
            {name}
          </Link>
          {/* Drafts only: the engine never selects one, and the design draws
              only active flows. */}
          {definition.status === "draft" && <StatusBadge status={definition.status} />}
        </div>
      }
      caption={
        purposes && (
          <>
            <LogIn className="size-3" aria-hidden />
            {purposes}
          </>
        )
      }
      chips={steps.map((step) => (
        <InlineCode key={step} className={DIRECTORY_CHIP}>
          {step}
        </InlineCode>
      ))}
      menu={
        <DropdownMenuItem asChild>
          <Link to="/flow-definitions/$definitionId" params={{ definitionId: id }}>
            View flow
          </Link>
        </DropdownMenuItem>
      }
    >
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
    </DirectoryRow>
  );
}
