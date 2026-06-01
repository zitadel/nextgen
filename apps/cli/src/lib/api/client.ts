import type {
  CreateFlowDefinitionBodyFlowDefinition,
  CreateProject201,
  CreateProjectBody,
  CreateSchemaBody,
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
 * Schema operations. Request bodies are the spec's
 * {@link CreateSchemaBody} discriminated union (`user-schema` or
 * `schema-url`), pulled directly from `@zitadel-nextgen/api`.
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
  createSchema(data: CreateSchemaBody, projectId: string): Promise<{ id: string }>;
  getSchema(id: string, projectId: string): Promise<CreateSchemaBody>;
  deleteSchema(id: string, projectId: string): Promise<void>;
}

/**
 * Envelope POSTed to `/flow_definitions`, per
 * `api/openapi/components/flows/flow-definition-create-request.yaml`.
 * The CLI's syncer wraps the bare on-disk flow body in this shape
 * before sending.
 */
export type CreateFlowDefinitionRequest = {
  project_id: string;
  flow_definition: CreateFlowDefinitionBodyFlowDefinition;
  schema_uri?: string;
};

/**
 * Detail envelope returned by `GET /flow_definitions/:id` and
 * `POST /flow_definitions`, per
 * `api/openapi/components/flows/flow-definition-detail-response.yaml`:
 * wrapper fields plus the bare flow body merged in.
 */
export type FlowDefinitionDetailResponse = CreateFlowDefinitionBodyFlowDefinition & {
  id: string;
  project_id: string;
  schema_uri: string;
  status: string;
  created_at: string;
  updated_at: string;
};

/**
 * Flow-definition operations. The create envelope is the spec's
 * {@link CreateFlowDefinitionRequest}; the PATCH body is a partial of
 * the same flow shape (per `flow-definition-update-request.yaml`,
 * which permits any subset of the flow's mutable fields).
 */
export interface FlowDefinitionClient {
  createFlowDefinition(req: CreateFlowDefinitionRequest): Promise<{ id: string }>;
  getFlowDefinition(id: string): Promise<FlowDefinitionDetailResponse>;
  updateFlowDefinition(
    id: string,
    data: Partial<CreateFlowDefinitionBodyFlowDefinition>,
  ): Promise<void>;
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
