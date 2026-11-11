import { api } from "@/api/zitadel";
import { schemaDisplayName } from "@/features/schemas/model";

import type { FlowDefinition, FlowDefinitionEntry } from "./model";

/** One row of the Login flows list. */
export interface FlowRow {
  id: string;
  definition: FlowDefinition;
  updatedAt: string;
  /** `undefined` when the schema does not resolve for this caller. */
  schemaName: string | undefined;
  /** The revision behind {@link schemaName}, for the row's link to the schema. */
  schemaId: string | undefined;
}

/** What the Login flows list shows. */
export interface LoginFlowsData {
  flows: FlowRow[];
}

/**
 * Reads a project's Login flows list: for the selected project's, and for the
 * root's of the reserved platform project (D41), which share it.
 */
export async function loadLoginFlows(projectId: string): Promise<LoginFlowsData> {
  // Without the embed the row has only the schema's objectType.
  // `latest` because this is a directory of flows, not a revision history:
  // publishing under an existing name generates a new row, and only the newest
  // one is the flow.
  const page = await api.listFlowDefinitions({
    project_id: projectId,
    revisions: "latest",
    expand: ["user_schema"],
  });
  return { flows: page.flow_definitions.map(toFlowRow) };
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
    schemaId: embed?.id,
  };
}

/** What a flow definition's detail shows. */
export interface FlowDefinitionData {
  definition: FlowDefinition;
  createdAt: string;
  schemaName?: string;
  schemaId?: string;
}

/**
 * Reads one flow definition, and names its schema in `projectId`: the selected
 * project's for the project route, the reserved platform project's at the root
 * (D41).
 */
export async function loadFlowDefinition(
  definitionId: string,
  projectId: string,
): Promise<FlowDefinitionData> {
  const entry = await api.getFlowDefinition(definitionId);
  // Structurally the list's `flow_definition`; orval renames per operation.
  const definition: FlowDefinition = entry.flow_definition;
  return {
    definition,
    createdAt: entry.created_at,
    // No `expand` on this endpoint, so the badge costs a second call.
    ...(await resolveSchema(definition.user_schema, projectId)),
  };
}

/** The newest revision of the schema the flow names by `objectType`. */
async function resolveSchema(
  objectType: string | undefined,
  projectId: string,
): Promise<{ schemaName?: string; schemaId?: string }> {
  if (!objectType) return {};
  try {
    const page = await api.listSchemas({
      project_id: projectId,
      object_type: objectType,
      revisions: "latest",
      limit: 1,
    });
    const latest = page.schemas[0];
    if (!latest) return {};
    return { schemaName: schemaDisplayName(latest.schema, objectType), schemaId: latest.id };
  } catch {
    return {};
  }
}
