import { createHash } from "node:crypto";

import type { PlatformClient } from "./client";
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

const CREATED_AT = "2026-04-21T14:03:11.000Z";
const APPLIED_AT = "2026-04-21T14:04:11.000Z";

export class MockPlatformClient implements PlatformClient {
  private readonly projects = new Map<string, GetProjectResponse>();
  private configVersion = 0;

  async createProject(req: CreateProjectRequest): Promise<CreateProjectResponse> {
    const projectId = toProjectId(req.slug_preference);
    const response: CreateProjectResponse = {
      project_id: projectId,
      project_secret: `sk_proj_mock_${projectId.replace(/[^a-z0-9]/g, "")}_full`,
      preview_secret: `sk_proj_mock_${projectId.replace(/[^a-z0-9]/g, "")}_preview`,
      preview_origins: req.preview_origins ?? [],
      created_at: CREATED_AT,
      scratch_dashboard_url: `https://zitadel.dev/scratch/${projectId}`,
      schema_version: 2,
    };

    this.projects.set(projectId, {
      project_id: projectId,
      lifecycle: "pre-claim",
      declared_issuers: {},
      preview_origins: response.preview_origins,
      created_at: response.created_at,
    });

    return response;
  }

  async getProject(projectId: string): Promise<GetProjectResponse> {
    return (
      this.projects.get(projectId) ?? {
        project_id: projectId,
        lifecycle: "pre-claim",
        declared_issuers: {},
        preview_origins: [],
        created_at: CREATED_AT,
      }
    );
  }

  async uploadConfig(
    projectId: string,
    environment: ZitadelEnvironment,
    req: UploadConfigRequest,
  ): Promise<UploadConfigResponse> {
    this.configVersion += 1;
    const existing = await this.getProject(projectId);
    const config = req.config as { environments?: Record<string, unknown> };
    this.projects.set(projectId, {
      ...existing,
      declared_issuers: {
        ...(existing.declared_issuers ?? {}),
        [environment]: config.environments?.[environment],
      },
      config_hash: req.hash,
    });

    return {
      config_version: this.configVersion,
      hash: req.hash,
      applied_at: APPLIED_AT,
      server_capabilities: {
        schema_version: "2.0",
        flow_protocol_version: "1.0",
        step_types: [
          "identifier",
          "credential",
          "form",
          "verification",
          "redirect",
          "info",
          "complete",
        ],
        idp_types: ["oidc"],
        delivery_modes: ["dev_inbox"],
        renderer_modes: ["default"],
        features: ["mock_platform", "preview_secrets", "capability_handshake_v1"],
      },
      warnings: [],
    };
  }

  async getConfig(projectId: string, environment: ZitadelEnvironment): Promise<unknown> {
    return {
      project_id: projectId,
      environment,
      source: "mock",
    };
  }

  async initClaim(projectId: string, _req: InitClaimRequest): Promise<InitClaimResponse> {
    return {
      claim_url: `https://zitadel.cloud/claim/${projectId}/mock-challenge`,
      challenge_id: "challenge_mock",
      expires_at: "2026-04-21T14:13:11.000Z",
    };
  }

  async getClaimStatus(_projectId: string, _challengeId: string): Promise<ClaimStatusResponse> {
    return { status: "pending" };
  }

  async getCapabilities(): Promise<CapabilitiesResponse> {
    return {
      mode: "mock",
      version: "2026-04-21",
      features: {
        browser_bootstrap: true,
        preview_secrets: true,
        config_apply: true,
      },
    };
  }
}

export function toProjectId(input: string | undefined): string {
  const base = (input ?? "river")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const clean = base || "river";
  const suffix = createHash("sha256").update(clean).digest("hex").slice(0, 4);
  return `${clean}-${Number.parseInt(suffix, 16).toString().slice(0, 4).padStart(4, "0")}`;
}
