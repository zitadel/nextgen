import {
  getCreateFlowDefinitionUrl,
  getCreateProjectUrl,
  getCreateSchemaUrl,
  getDeleteFlowDefinitionUrl,
  getGetFlowDefinitionUrl,
  getGetProjectUrl,
  getGetSchemaByIdUrl,
  getUpdateFlowDefinitionUrl,
} from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen";
import type {
  CreateProject201,
  CreateProjectBody,
  GetProject200,
} from "@zitadel-nextgen/api/generated/model";
import { setApiBaseUrl } from "@zitadel-nextgen/api/runtime/base-url";

import { ZitadelError } from "../errors";
import type { PlatformClient } from "./client";

/**
 * HTTP implementation of {@link PlatformClient}. Paths come from the
 * generated URL builders in `@zitadel-nextgen/api` (single source of
 * truth with the OpenAPI spec); this class adds the two concerns the
 * generated fetch client deliberately omits — bearer auth and
 * status→`ZitadelError` mapping. The generated `client: "fetch"` output
 * returns parsed bodies without checking `res.ok`, so error handling
 * has to live here.
 */
export class HttpPlatformClient implements PlatformClient {
  constructor(baseUrl: string, private readonly secret?: string) {
    // The generated URL builders read a module-global base URL. A CLI
    // process targets one server per run, so setting it here is safe.
    setApiBaseUrl(baseUrl.replace(/\/+$/, ""));
  }

  async createProject(req: CreateProjectBody): Promise<CreateProject201> {
    return this.request("POST", getCreateProjectUrl(), req);
  }

  async getProject(projectId: string): Promise<GetProject200> {
    return this.request("GET", getGetProjectUrl(projectId));
  }

  async createSchema(data: object): Promise<{ id: string }> {
    return this.request("POST", getCreateSchemaUrl(), data);
  }

  async getSchema(id: string): Promise<object> {
    return this.request("GET", getGetSchemaByIdUrl(id));
  }

  async deleteSchema(id: string): Promise<void> {
    // No dedicated delete-schema endpoint in the spec; the resource path
    // is the same as get-by-id, so reuse that URL with DELETE.
    return this.request("DELETE", getGetSchemaByIdUrl(id));
  }

  async createFlowDefinition(req: object): Promise<{ id: string }> {
    return this.request("POST", getCreateFlowDefinitionUrl(), req);
  }

  async getFlowDefinition(id: string): Promise<object> {
    return this.request("GET", getGetFlowDefinitionUrl(id));
  }

  async updateFlowDefinition(id: string, data: object): Promise<void> {
    return this.request("PATCH", getUpdateFlowDefinitionUrl(id), data);
  }

  async deleteFlowDefinition(id: string): Promise<void> {
    return this.request("DELETE", getDeleteFlowDefinitionUrl(id));
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const response = await fetch(url, {
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
