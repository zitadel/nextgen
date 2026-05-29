import { FLOWS_DIR, flowEnvRefs, validateFlows } from "../flows";
import { SCHEMAS_DIR, validateJsonSchema } from "../user-schema";
import { ZitadelError } from "../errors";
import type { PlatformClient } from "../api/client.js";
import type { ResourceSyncer } from "./types.js";

/** Runtime environment lookup used to resolve `${VAR}` / `*_env` references. */
type EnvLookup = Record<string, string | undefined>;

/**
 * Build the syncer list with the context every syncer needs: the
 * `project_id` flow creates carry, and the runtime `env` against which
 * each file's `${VAR}` / `*_env` references are checked. Callers
 * (apply / plan / setup) read `project_id` from `.zitadel/secret` and
 * pass the process environment. The returned array is treated as
 * read-only by the sync loop.
 */
export function makeSyncers(opts: {
  projectId: string;
  env: EnvLookup;
}): ReadonlyArray<ResourceSyncer> {
  return [new SchemaSyncer(opts.env), new FlowDefinitionSyncer(opts.projectId, opts.env)];
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

  constructor(private readonly env: EnvLookup) {}

  validate(data: object): void {
    const result = validateJsonSchema(data);
    if (!result.valid) {
      throw new ZitadelError("E_VALIDATION", "User schema is not a valid JSON Schema", {
        details: { errors: result.errors },
      });
    }
    assertEnvRefs(data, this.env);
  }

  async create(client: PlatformClient, data: object): Promise<string> {
    const result = await client.createSchema(data);
    return result.id;
  }

  async update(_client: PlatformClient, _id: string, _data: object): Promise<void> {
    // Never called — mutable = false. Schemas are immutable on the platform.
  }

  async delete(client: PlatformClient, id: string): Promise<void> {
    await client.deleteSchema(id);
  }

  async fetch(client: PlatformClient, id: string): Promise<object> {
    return client.getSchema(id);
  }
}

class FlowDefinitionSyncer implements ResourceSyncer {
  readonly kind = "flow";
  readonly directory = FLOWS_DIR;
  readonly mutable = true;

  constructor(
    private readonly projectId: string,
    private readonly env: EnvLookup,
  ) {}

  validate(data: object): void {
    // `validateFlows` takes a batch and throws `E_VALIDATION` on the
    // first invalid entry; a single-element array validates one file.
    validateFlows([data]);
    assertEnvRefs(data, this.env);
  }

  async create(client: PlatformClient, data: object): Promise<string> {
    // Wrap the bare flow body in the spec envelope before sending.
    // The on-disk file stays bare so it is editable by humans; only
    // the wire request carries `project_id` and the surrounding
    // envelope per
    // `api/openapi/components/flows/flow-definition-create-request.yaml`.
    const result = await client.createFlowDefinition({
      project_id: this.projectId,
      flow_definition: data,
    });
    return result.id;
  }

  async update(client: PlatformClient, id: string, data: object): Promise<void> {
    // PATCH body is the bare partial flow per
    // `flow-definition-update-request` — no envelope.
    await client.updateFlowDefinition(id, data);
  }

  async delete(client: PlatformClient, id: string): Promise<void> {
    await client.deleteFlowDefinition(id);
  }

  async fetch(client: PlatformClient, id: string): Promise<object> {
    // The GET /flow_definitions/:id response wraps the bare flow body
    // in a detail envelope (`id`, `project_id`, `schema_uri`,
    // `status`, `created_at`, `updated_at`). Strip those envelope
    // fields before returning so the diff compares apples-to-apples
    // against the on-disk flow file, which stores only the bare body.
    const {
      id: _id,
      project_id: _projectId,
      schema_uri: _schemaUri,
      status: _status,
      created_at: _createdAt,
      updated_at: _updatedAt,
      ...body
    } = (await client.getFlowDefinition(id)) as Record<string, unknown>;
    return body;
  }
}
