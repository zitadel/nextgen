import type {
  CapabilitiesResponse,
  ClaimStatusResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  GetProjectResponse,
  InitClaimRequest,
  InitClaimResponse,
  UploadConfigRequest,
  UploadConfigResponse,
  ZitadelEnvironment,
} from "./schemas";

export interface ProjectClient {
  createProject(req: CreateProjectRequest): Promise<CreateProjectResponse>;
  getProject(projectId: string): Promise<GetProjectResponse>;
}

export interface ConfigClient {
  uploadConfig(
    projectId: string,
    environment: ZitadelEnvironment,
    req: UploadConfigRequest,
  ): Promise<UploadConfigResponse>;
  getConfig(projectId: string, environment: ZitadelEnvironment): Promise<unknown>;
}

export interface SchemaClient {
  createSchema(data: object): Promise<{ id: string }>;
  getSchema(id: string): Promise<object>;
  deleteSchema(id: string): Promise<void>;
}

export interface FlowDefinitionClient {
  createFlowDefinition(data: object): Promise<{ id: string }>;
  updateFlowDefinition(id: string, data: object): Promise<void>;
  deleteFlowDefinition(id: string): Promise<void>;
}

export interface ClaimClient {
  initClaim(projectId: string, req: InitClaimRequest): Promise<InitClaimResponse>;
  getClaimStatus(projectId: string, challengeId: string): Promise<ClaimStatusResponse>;
}

export interface CapabilitiesClient {
  getCapabilities(): Promise<CapabilitiesResponse>;
}

export type PlatformClient = ProjectClient &
  ConfigClient &
  SchemaClient &
  FlowDefinitionClient &
  ClaimClient &
  CapabilitiesClient;
