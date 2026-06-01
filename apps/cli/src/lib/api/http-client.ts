/**
 * HTTP implementation of the {@link PlatformClient} surface, the only piece
 * of the CLI that talks directly to the Zitadel platform. The generated
 * `client: "fetch"` output in `@zitadel-nextgen/api` returns parsed bodies
 * without checking `res.ok`, so this layer adds the two concerns the
 * generated client deliberately omits — bearer authentication and the
 * status → {@link ZitadelError} mapping (`401`/`403` → `E_AUTH`, `5xx` →
 * `E_NETWORK`, everything else → `E_VALIDATION`).
 *
 * URLs are built by the generated builders so they stay in lockstep with
 * the OpenAPI spec; this module never hand-crafts a path.
 */

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

import type {
  CreateFlowDefinitionBodyFlowDefinition,
  CreateSchemaBody,
} from "@zitadel-nextgen/api/generated/model";

import { ZitadelError, type ZitadelErrorCode } from "../errors";
import type {
  CreateFlowDefinitionRequest,
  FlowDefinitionDetailResponse,
  PlatformClient,
} from "./client";

/**
 * Maps an HTTP status to a {@link ZitadelErrorCode}:
 * `401` / `403` → `E_AUTH` (bad or missing project secret), `5xx` →
 * `E_NETWORK` (server-side or transport), every other non-`ok` status
 * → `E_VALIDATION` (the client sent something the platform rejected,
 * e.g. `400`, `404`, `409`).
 */
function statusToCode(status: number): ZitadelErrorCode {
  if (status === 401 || status === 403) {
    return "E_AUTH";
  }
  if (status >= 500) {
    return "E_NETWORK";
  }
  return "E_VALIDATION";
}

/** The only concrete {@link PlatformClient} this CLI ships. */
export class HttpPlatformClient implements PlatformClient {
  /**
   * The generated URL builders read a module-global base URL. A CLI
   * process targets one server per run, so setting it from the constructor
   * is safe and matches the generated client's contract.
   */
  constructor(baseUrl: string, private readonly secret?: string) {
    setApiBaseUrl(baseUrl.replace(/\/+$/, ""));
  }

  async createProject(req: CreateProjectBody): Promise<CreateProject201> {
    return this.request("POST", getCreateProjectUrl(), req);
  }

  async getProject(projectId: string): Promise<GetProject200> {
    return this.request("GET", getGetProjectUrl(projectId));
  }

  async createSchema(data: CreateSchemaBody, projectId: string): Promise<{ id: string }> {
    return this.request("POST", getCreateSchemaUrl({ project_id: projectId }), data);
  }

  async getSchema(id: string, projectId: string): Promise<CreateSchemaBody> {
    return this.request("GET", getGetSchemaByIdUrl(id, { project_id: projectId }));
  }

  /**
   * The spec has no dedicated delete-schema URL builder; the resource path
   * is the same as get-by-id, so we reuse that URL with the DELETE verb.
   */
  async deleteSchema(id: string, projectId: string): Promise<void> {
    return this.request("DELETE", getGetSchemaByIdUrl(id, { project_id: projectId }));
  }

  async createFlowDefinition(req: CreateFlowDefinitionRequest): Promise<{ id: string }> {
    return this.request("POST", getCreateFlowDefinitionUrl(), req);
  }

  async getFlowDefinition(id: string): Promise<FlowDefinitionDetailResponse> {
    return this.request("GET", getGetFlowDefinitionUrl(id));
  }

  async updateFlowDefinition(
    id: string,
    data: Partial<CreateFlowDefinitionBodyFlowDefinition>,
  ): Promise<void> {
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
        statusToCode(response.status),
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
