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

export interface ClaimClient {
  initClaim(projectId: string, req: InitClaimRequest): Promise<InitClaimResponse>;
  getClaimStatus(projectId: string, challengeId: string): Promise<ClaimStatusResponse>;
}

export interface CapabilitiesClient {
  getCapabilities(): Promise<CapabilitiesResponse>;
}

export type PlatformClient = ProjectClient & ConfigClient & ClaimClient & CapabilitiesClient;
