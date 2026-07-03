import type {
  CreateFlowDefinitionBodyFlowDefinition,
  UpdateFlowDefinitionBodyFlowDefinition,
  CreateSchemaBody,
  GetSchemaById200,
  GetFlowDefinition200,
} from "@zitadel/api/generated/model";
import type { ZitadelClient } from "@zitadel/api/client";
import { DEFAULT_FLOW_SCHEMA_URI, resolveSchemaUrl } from "@zitadel/config/defaults";
import { flowConfigSchema, schemaConfigSchema } from "@zitadel/config/schemas";

import { FLOWS_DIR, flowEnvRefs, validateFlows } from "../flows";
import { SCHEMAS_DIR } from "../user-schema";
import { ZitadelError } from "../errors";
import type { ResourceSyncer } from "./types.js";

/** Runtime environment lookup used to resolve `${VAR}` / `*_env` references. */
type EnvLookup = Record<string, string | undefined>;

/**
 * Build the syncer list with the context every syncer needs: the
 * `project_id` flow creates carry, the runtime `env` against which
 * each file's `${VAR}` / `*_env` references are checked, and the
 * `serverBaseUrl` revisioned syncers use to compose the URL a new
 * revision is reachable at. Callers (apply / plan / setup) read
 * `project_id` from `.zitadel/secret`, pass the process environment,
 * and pass the resolved server base (`this.meta.source`). The returned
 * array is treated as read-only by the sync loop.
 */
export function makeSyncers(opts: {
  client: ZitadelClient;
  projectId: string;
  env: EnvLookup;
  serverBaseUrl: string;
}): ReadonlyArray<ResourceSyncer> {
  const schemasBase = joinPath(opts.serverBaseUrl, "/api/schemas");
  return [
    new SchemaSyncer(opts.client, opts.projectId, opts.env, schemasBase),
    new FlowDefinitionSyncer(opts.client, opts.projectId, opts.env),
  ];
}

/**
 * Assert that every env var a resource references — `${VAR}` placeholders and
 * the `*_env` convention — is present in `env`, throwing `E_VALIDATION` listing
 * the missing names. Shared by every syncer so the check is identical for
 * schemas and flows, and runs in the sync engine before any platform call.
 */
function assertEnvRefs(data: object, env: EnvLookup): void {
  const missing = flowEnvRefs(data).filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new ZitadelError("E_VALIDATION", `Missing environment variables: ${missing.join(", ")}`);
  }
}

class SchemaSyncer implements ResourceSyncer {
  readonly kind = "schema";
  readonly directory = SCHEMAS_DIR;
  readonly mutable = false;
  readonly revisioned = true;

  constructor(
    private readonly client: ZitadelClient,
    private readonly projectId: string,
    private readonly env: EnvLookup,
    private readonly schemasBaseUrl: string,
  ) {}

  /**
   * Parse against the generated `CreateSchemaBody` Zod (the orval-emitted
   * equivalent of `api/openapi/endpoints/schemas/user-schema.yaml`). The
   * generated schema is a union of `user-schema` and `schema-url`
   * discriminated on `kind`; both are valid on-disk bodies.
   */
  validate(data: object): void {
    const result = schemaConfigSchema.safeParse(data);
    if (!result.success) {
      throw new ZitadelError("E_VALIDATION", "Schema file is not a valid Zitadel schema body", {
        details: { issues: result.error.issues },
      });
    }
    assertEnvRefs(data, this.env);
  }

  async create(data: object): Promise<string> {
    const result = await this.client.createSchema(data as CreateSchemaBody, {
      project_id: this.projectId,
    });
    return result.id;
  }

  /**
   * Not called by the sync loop: schemas are `revisioned`, so a hash change
   * publishes a new immutable revision through {@link create} rather than
   * mutating an existing row. Kept as a required interface member; throws
   * loudly if a caller reaches it.
   */
  async update(_id: string, _data: object): Promise<void> {
    throw new ZitadelError("E_NOT_IMPLEMENTED", "schemas are revisioned — edit publishes a new revision, not an update");
  }

  async delete(id: string): Promise<void> {
    // Schemas are immutable on the platform: no PATCH, no DELETE in the
    // generated client. The sync loop's delete branch (`loop.ts`) still
    // schedules a delete action when a state entry exists and the
    // on-disk file is gone — `mutable` only gates updates, not deletes.
    // We deliberately fail loud here so the user notices that removing
    // a schema file is not a supported way to retire it.
    throw new ZitadelError("E_NOT_IMPLEMENTED", `schema delete is not supported (${id})`);
  }

  async fetch(id: string): Promise<object> {
    const body = await this.client.getSchemaById(encodeURIComponent(id), {
      project_id: this.projectId,
    });
    return body as unknown as GetSchemaById200;
  }

  resolveUrl(id: string): string {
    return resolveSchemaUrl(id, this.schemasBaseUrl);
  }
}

class FlowDefinitionSyncer implements ResourceSyncer {
  readonly kind = "flow";
  readonly directory = FLOWS_DIR;
  readonly mutable = true;
  readonly revisioned = false;

  constructor(
    private readonly client: ZitadelClient,
    private readonly projectId: string,
    private readonly env: EnvLookup,
  ) {}

  /**
   * Validates one flow file. `validateFlows` takes a batch and throws
   * `E_VALIDATION` on the first invalid entry; passing a single-element array
   * lets us reuse the batch validator for one file.
   */
  validate(data: object): void {
    const result = flowConfigSchema.safeParse(data);
    if (!result.success) {
      throw new ZitadelError("E_VALIDATION", "Flow file is not a valid Zitadel flow body", {
        details: { issues: result.error.issues },
      });
    }
    validateFlows([data]);
    assertEnvRefs(data, this.env);
  }

  /**
   * Wraps the bare on-disk flow body in the spec's create-envelope
   * (`api/openapi/components/flows/flow-definition-create-request.yaml`)
   * before sending. The file on disk stays bare so it is human-editable;
   * only the wire request carries `project_id` and the surrounding
   * envelope.
   */
  async create(data: object): Promise<string> {
    const result = await this.client.createFlowDefinition({
      project_id: this.projectId,
      schema_uri: DEFAULT_FLOW_SCHEMA_URI,
      flow_definition: data as CreateFlowDefinitionBodyFlowDefinition,
    });
    return result.id;
  }

  /**
   * PUT completely replaces the flow definition. The wire request wraps the
   * bare on-disk flow in the `{ flow_definition }` update envelope
   * (`api/openapi/components/flows/flow-definition-update-request.yaml`) and
   * carries `project_id` as a query parameter; the file on disk stays bare so
   * it is human-editable.
   */
  async update(id: string, data: object): Promise<void> {
    await this.client.updateFlowDefinition(
      id,
      { flow_definition: data as UpdateFlowDefinitionBodyFlowDefinition },
      { project_id: this.projectId },
    );
  }

  async delete(id: string): Promise<void> {
    await this.client.deleteFlowDefinition(id, { project_id: this.projectId });
  }

  /**
   * `GET /flow_definitions/:id` wraps the bare flow body in a detail envelope
   * (`id`, `project_id`, `schema_uri`, `status`, `created_at`, `updated_at`).
   * Strip those envelope fields here so the diff renderer compares
   * apples-to-apples against the on-disk file, which stores only the bare
   * body.
   */
  async fetch(id: string): Promise<object> {
    const envelope = (await this.client.getFlowDefinition(id, {
      project_id: this.projectId,
    })) as GetFlowDefinition200;
    if ("flow_definition" in envelope && envelope.flow_definition) {
      return envelope.flow_definition as unknown as object;
    }
    const {
      id: _id,
      project_id: _projectId,
      schema_uri: _schemaUri,
      status: _status,
      created_at: _createdAt,
      updated_at: _updatedAt,
      ...body
    } = envelope;
    return body;
  }
}

function joinPath(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/u, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
