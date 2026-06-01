import type {
  CreateProject201,
  CreateProjectBody,
  GetProject200,
} from "@zitadel-nextgen/api/generated/model";

/**
 * Project operations. These carry known request/response shapes, so
 * they use the generated models directly.
 */
export interface ProjectClient {
  createProject(req: CreateProjectBody): Promise<CreateProject201>;
  getProject(projectId: string): Promise<GetProject200>;
}

/**
 * Schema operations. The sync layer feeds opaque JSON bodies read from
 * `.zitadel/schemas/`, so request/response payloads stay `object` — the
 * generated `CreateSchemaBody` / `GetSchemaById200` shapes are
 * deliberately not imposed here (the sync layer is shape-agnostic).
 *
 * Every method takes `projectId` as a required argument: the platform's
 * `/schemas` endpoints declare `project_id` as a required query
 * parameter (`api/openapi/components/parameters/project-id.yaml`).
 * The generated URL builders don't emit it, so the implementation
 * appends `?project_id=…` itself; callers must supply it.
 *
 * The platform has no delete-schema endpoint; `deleteSchema` reuses the
 * by-id URL with the DELETE method.
 */
export interface SchemaClient {
  createSchema(data: object, projectId: string): Promise<{ id: string }>;
  getSchema(id: string, projectId: string): Promise<object>;
  deleteSchema(id: string, projectId: string): Promise<void>;
}

/**
 * Flow-definition operations. Like schemas, bodies are opaque `object`
 * payloads supplied by the sync layer (the create envelope
 * `{ project_id, flow_definition }` is assembled by the syncer).
 */
export interface FlowDefinitionClient {
  createFlowDefinition(req: object): Promise<{ id: string }>;
  getFlowDefinition(id: string): Promise<object>;
  updateFlowDefinition(id: string, data: object): Promise<void>;
  deleteFlowDefinition(id: string): Promise<void>;
}

/**
 * The full platform surface the CLI talks to. Backed by
 * {@link HttpPlatformClient}, which wires each method to the generated
 * URL builders in `@zitadel-nextgen/api` and adds the CLI-specific
 * concerns the generated fetch client omits: bearer auth and
 * status→`ZitadelError` mapping.
 */
export type PlatformClient = ProjectClient & SchemaClient & FlowDefinitionClient;

/**
 * The generated project-response type, re-exported under the name the
 * CLI threads around (e.g. `setup`'s scaffold plan).
 */
export type CreateProjectResponse = CreateProject201;
