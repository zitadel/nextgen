import type {
  CreateFlowDefinition201,
  CreateFlowDefinitionBodyFlowDefinition,
  UpdateFlowDefinition200,
  UpdateFlowDefinitionBodyFlowDefinition,
  CreateSchemaBody,
  GetSchemaById200,
  GetFlowDefinition200,
} from "@zitadel/api/generated/model";
import { consola } from "consola";

import type { ZitadelClient } from "@zitadel/api/client";
import { DEFAULT_FLOW_SCHEMA_URI } from "@zitadel/config/defaults";
import { normalizeFlowBody, normalizeSchemaBody } from "@zitadel/config/normalize";
import { flowConfigSchema, schemaConfigSchema } from "@zitadel/config/schemas";

import { FLOWS_DIR, flowEnvRefs } from "../flows";
import { SCHEMAS_DIR } from "../user-schema";
import { ZitadelError } from "../errors";
import type { ResourceSyncer } from "./types.js";

/** Runtime environment lookup used to resolve `${VAR}` / `*_env` references. */
type EnvLookup = Record<string, string | undefined>;

/**
 * Build the syncer list with the context every syncer needs: the
 * `project_id` flow creates carry, and the runtime `env` against which
 * each file's `${VAR}` / `*_env` references are checked. Callers (apply /
 * plan / setup) read `project_id` from `.zitadel/secret` and pass the
 * process environment. The returned array is treated as read-only by the
 * sync loop.
 */
export function makeSyncers(opts: {
  client: ZitadelClient;
  projectId: string;
  env: EnvLookup;
}): ReadonlyArray<ResourceSyncer> {
  return [
    new SchemaSyncer(opts.client, opts.projectId, opts.env),
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
  readonly normalize = normalizeSchemaBody;

  constructor(
    private readonly client: ZitadelClient,
    private readonly projectId: string,
    private readonly env: EnvLookup,
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

  /**
   * `POST /schemas` mints a new immutable row. The server allocates the
   * opaque id; the CLI records it in state and re-pins flows against it.
   * The create response carries only the id, so the canonical stored body
   * comes from a follow-up fetch; a fetch failure degrades to no
   * write-back rather than failing the create.
   */
  async create(data: object): Promise<{ id: string; canonical?: object }> {
    const result = await this.client.createSchema(data as CreateSchemaBody, {
      project_id: this.projectId,
    });
    try {
      return { id: result.id, canonical: await this.fetch(result.id) };
    } catch (err) {
      consola.debug(`fetch created schema ${result.id} failed:`, err);
      return { id: result.id };
    }
  }

  /**
   * Not called by the sync loop: schemas are `revisioned`, so a hash change
   * publishes a new immutable revision through {@link create} rather than
   * mutating an existing row. Kept as a required interface member; throws
   * loudly if a caller reaches it.
   */
  async update(_id: string, _data: object): Promise<{ canonical?: object }> {
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
}

class FlowDefinitionSyncer implements ResourceSyncer {
  readonly kind = "flow";
  readonly directory = FLOWS_DIR;
  readonly mutable = true;
  readonly revisioned = false;
  readonly normalize = normalizeFlowBody;

  constructor(
    private readonly client: ZitadelClient,
    private readonly projectId: string,
    private readonly env: EnvLookup,
  ) {}

  /**
   * Validates one flow file against the canonical `flowConfigSchema` (the
   * same Zod `validateFlows` and doctor use), then checks env references.
   */
  validate(data: object): void {
    const result = flowConfigSchema.safeParse(data);
    if (!result.success) {
      throw new ZitadelError("E_VALIDATION", "Flow file is not a valid Zitadel flow body", {
        details: { issues: result.error.issues },
      });
    }
    assertEnvRefs(data, this.env);
  }

  /**
   * Wraps the bare on-disk flow body in the spec's create-envelope
   * (`api/openapi/components/flows/flow-definition-create-request.yaml`)
   * before sending. The file on disk stays bare so it is human-editable;
   * only the wire request carries `project_id` and the surrounding
   * envelope.
   */
  async create(data: object): Promise<{ id: string; canonical?: object }> {
    const result = (await this.client.createFlowDefinition({
      project_id: this.projectId,
      schema_uri: DEFAULT_FLOW_SCHEMA_URI,
      flow_definition: data as CreateFlowDefinitionBodyFlowDefinition,
    })) as CreateFlowDefinition201;
    return { id: result.id, canonical: result.flow_definition as object };
  }

  /**
   * PUT completely replaces the flow definition. The wire request wraps the
   * bare on-disk flow in the `{ flow_definition }` update envelope
   * (`api/openapi/components/flows/flow-definition-update-request.yaml`) and
   * carries `project_id` as a query parameter; the file on disk stays bare so
   * it is human-editable.
   */
  async update(id: string, data: object): Promise<{ canonical?: object }> {
    const result = (await this.client.updateFlowDefinition(
      id,
      { flow_definition: data as UpdateFlowDefinitionBodyFlowDefinition },
      { project_id: this.projectId },
    )) as UpdateFlowDefinition200;
    return { canonical: result.flow_definition as object };
  }

  async delete(id: string): Promise<void> {
    await this.client.deleteFlowDefinition(id, { project_id: this.projectId });
  }

  /**
   * `GET /flow_definitions/:id` returns a detail envelope with metadata
   * (`id`, `project_id`, `created_at`, `updated_at`) plus `flow_definition`.
   * Return only `flow_definition` so diffs compare with the on-disk bare body.
   */
  async fetch(id: string): Promise<object> {
    const envelope = (await this.client.getFlowDefinition(
      id,
      { project_id: this.projectId },
    )) as GetFlowDefinition200;

    return envelope.flow_definition as object;
  }
}
