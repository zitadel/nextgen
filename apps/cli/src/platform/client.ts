import type {
  CreateProjectRequest,
  CreateProjectResponse,
  GetProjectResponse,
} from "./schemas";

export interface ProjectClient {
  createProject(req: CreateProjectRequest): Promise<CreateProjectResponse>;
  getProject(projectId: string): Promise<GetProjectResponse>;
}

export interface SchemaClient {
  createSchema(data: object): Promise<{ id: string }>;
  getSchema(id: string): Promise<object>;
  deleteSchema(id: string): Promise<void>;
}

/**
 * Request envelope for `POST /flow_definitions` per the OpenAPI spec
 * (`api/openapi/components/flows/flow-definition-create-request.yaml`).
 * The flow body itself goes under `flow_definition`.
 */
export interface CreateFlowDefinitionRequest {
  readonly project_id: string;
  readonly schema_uri?: string;
  readonly flow_definition: object;
}

export interface FlowDefinitionClient {
  createFlowDefinition(req: CreateFlowDefinitionRequest): Promise<{ id: string }>;
  getFlowDefinition(id: string): Promise<object>;
  updateFlowDefinition(id: string, data: object): Promise<void>;
  deleteFlowDefinition(id: string): Promise<void>;
}

export type PlatformClient = ProjectClient & SchemaClient & FlowDefinitionClient;
