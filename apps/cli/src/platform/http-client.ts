import { ZitadelError } from "../lib/errors";
import type { CreateFlowDefinitionRequest, PlatformClient } from "./client";
import type {
  CreateProjectRequest,
  CreateProjectResponse,
  GetProjectResponse,
} from "./schemas";

export class HttpPlatformClient implements PlatformClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret?: string,
  ) {}

  async createProject(req: CreateProjectRequest): Promise<CreateProjectResponse> {
    return this.request("POST", "/projects", req);
  }

  async getProject(projectId: string): Promise<GetProjectResponse> {
    return this.request("GET", `/projects/${encodeURIComponent(projectId)}`);
  }

  async applyProjectConfig(
    projectId: string,
    environment: string,
    data: object = {},
  ): Promise<import("./schemas").ApplyProjectConfigResponse> {
    const query = new URLSearchParams({ environment });
    return this.request(
      "PATCH",
      `/projects/${encodeURIComponent(projectId)}/config?${query.toString()}`,
      data,
    );
  }

  async initProjectClaim(
    projectId: string,
    req?: { return_url?: string; suggested_team_name?: string },
  ): Promise<import("./schemas").InitProjectClaimResponse> {
    return this.request("POST", `/projects/${encodeURIComponent(projectId)}/claim/init`, req ?? {});
  }

  async getProjectClaimStatus(
    projectId: string,
    challengeId: string,
  ): Promise<import("./schemas").GetProjectClaimStatusResponse> {
    const query = new URLSearchParams({ challenge_id: challengeId });
    return this.request(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/claim/status?${query.toString()}`,
    );
  }

  async createSchema(data: object): Promise<{ id: string }> {
    return this.request("POST", "/schemas", data);
  }

  async getSchema(id: string): Promise<object> {
    return this.request("GET", `/schemas/${encodeURIComponent(id)}`);
  }

  async deleteSchema(id: string): Promise<void> {
    return this.request("DELETE", `/schemas/${encodeURIComponent(id)}`);
  }

  async createFlowDefinition(req: CreateFlowDefinitionRequest): Promise<{ id: string }> {
    return this.request("POST", "/flow_definitions", req);
  }

  async getFlowDefinition(id: string): Promise<object> {
    return this.request("GET", `/flow_definitions/${encodeURIComponent(id)}`);
  }

  async updateFlowDefinition(id: string, data: object): Promise<void> {
    return this.request("PATCH", `/flow_definitions/${encodeURIComponent(id)}`, data);
  }

  async deleteFlowDefinition(id: string): Promise<void> {
    return this.request("DELETE", `/flow_definitions/${encodeURIComponent(id)}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.secret ? { authorization: `Bearer ${this.secret}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const details = await safeJson(response);
      const apiCode = readApiErrorCode(details);
      if (response.status === 409 && apiCode === "proj.claim_required") {
        throw new ZitadelError("E_CLAIM_REQUIRED", "Project claim required", {
          hint: "Run `zitadel claim`, then retry this command.",
          nextCommands: ["zitadel claim"],
          details,
        });
      }
      throw new ZitadelError(
        response.status >= 500 ? "E_NETWORK" : "E_VALIDATION",
        `Zitadel API returned ${response.status}`,
        {
          details,
        },
      );
    }

    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return undefined as T;
    }
    return (await response.json()) as T;
  }
}

function readApiErrorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("code" in value)) return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
