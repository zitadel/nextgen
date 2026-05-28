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
      throw new ZitadelError(
        response.status >= 500 ? "E_NETWORK" : "E_VALIDATION",
        `Zitadel API returned ${response.status}`,
        {
          details: await safeJson(response),
        },
      );
    }

    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return undefined as T;
    }
    return (await response.json()) as T;
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
