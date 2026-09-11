import { writeFileSync } from "node:fs";

import type {
  CreateBranding201,
  CreateBrandingBody,
  CreateFlowDefinition201,
  CreateFlowDefinitionBodyFlowDefinition,
  GetBrandingById200,
  CreateSchemaBody,
  GetSchemaById200,
  GetFlowDefinition200,
} from "@zitadel/api/generated/model";
import { consola } from "consola";

import type { ZitadelClient } from "@zitadel/api/client";
import { DEFAULT_FLOW_SCHEMA_URI } from "@zitadel/config/defaults";
import { normalizeFlowBody, normalizeSchemaBody } from "@zitadel/config/normalize";
import { brandingConfigSchema, flowConfigSchema, schemaConfigSchema } from "@zitadel/config/schemas";
import { validateLoginTemplate } from "@zitadel/config/template";

import {
  BRANDING_DIR,
  readDescriptorTemplate,
  resolveTemplatePath,
  toBrandingWireBody,
  toLocalBrandingBody,
} from "../branding";
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
  /**
   * Project root. The branding syncer resolves `liquid_template_file`
   * references against it when inlining templates for hashing and upload.
   */
  cwd: string;
}): ReadonlyArray<ResourceSyncer> {
  return [
    new SchemaSyncer(opts.client, opts.projectId, opts.env),
    new FlowDefinitionSyncer(opts.client, opts.projectId, opts.env),
    new BrandingSyncer(opts.client, opts.projectId, opts.env, opts.cwd),
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
  // Deliberately no `normalizeWrite`: the server stores schema bytes
  // verbatim, so stripping spelled-out x-* defaults from the local file
  // would drop them from the next published revision. Canonical schema
  // bodies are written back as-is; `normalize` is comparison-only.

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
    // Flat-by-id: authz resolves the project from RSI; no project_id query.
    // The response is the `{id, schema, metadata}` envelope; only the
    // customer-authored document is written back to `.zitadel/schemas/`.
    const body = (await this.client.getSchemaById(
      encodeURIComponent(id),
    )) as unknown as GetSchemaById200;
    return body.schema;
  }
}

/**
 * Flow definitions are revisioned like schemas: every edit publishes a new
 * immutable revision via `POST /flow_definitions`, no update or delete. The
 * revisions of one flow share its `name`; the runtime serves the newest.
 */
class FlowDefinitionSyncer implements ResourceSyncer {
  readonly kind = "flow";
  readonly directory = FLOWS_DIR;
  readonly mutable = false;
  readonly revisioned = true;
  readonly normalize = normalizeFlowBody;
  // For flows the comparison form doubles as the file form: everything it
  // strips (envelope keys, the empty `audience` echo) is transport noise.
  readonly normalizeWrite = normalizeFlowBody;

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
   * `POST /flow_definitions` publishes a new immutable revision and returns
   * its id. Wraps the bare on-disk flow body in the spec's create-envelope
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

  async update(_id: string, _data: object): Promise<{ canonical?: object }> {
    throw new ZitadelError(
      "E_NOT_IMPLEMENTED",
      "flows are revisioned — edit publishes a new revision, not an update",
    );
  }

  async delete(id: string): Promise<void> {
    // Flow revisions are immutable on the platform; removing the local file
    // does not retire them. The newest revision of the name keeps being
    // served — publish a new revision to change what users see.
    throw new ZitadelError("E_NOT_IMPLEMENTED", `flow delete is not supported (${id})`);
  }

  /**
   * `GET /flow_definitions/:id` returns a response envelope with metadata
   * (`id`, `project_id`, `created_at`, `updated_at`) plus `flow_definition`.
   * Return only `flow_definition` so diffs compare with the on-disk bare body.
   * Flat-by-id: no `project_id` query — authz resolves the project from RSI.
   */
  async fetch(id: string): Promise<object> {
    const envelope = (await this.client.getFlowDefinition(id)) as GetFlowDefinition200;

    return envelope.flow_definition as object;
  }
}

/**
 * Branding revisions (ADR 040): schema-style immutable semantics — every
 * edit publishes a new revision via `POST /branding`, no update or delete.
 * Unlike schemas, nothing references branding revisions, so a revise never
 * triggers re-pinning. The descriptor keeps the template in a sibling
 * `.liquid` file (`liquid_template_file`); this syncer inlines it for
 * hashing and upload and splits it back out on write-back.
 */
class BrandingSyncer implements ResourceSyncer {
  readonly kind = "branding";
  readonly directory = BRANDING_DIR;
  readonly mutable = false;
  readonly revisioned = true;
  /** One project, one branding descriptor — extra .json files fail the scan. */
  readonly singletonFile = "branding.json";

  constructor(
    private readonly client: ZitadelClient,
    private readonly projectId: string,
    private readonly env: EnvLookup,
    private readonly cwd: string,
  ) {}

  /**
   * The comparison form is the wire body with the template inlined, so an
   * edit to the referenced `.liquid` file changes the state hash and plans
   * a `revise` even though the descriptor JSON is untouched.
   */
  readonly normalize = (data: object): object => toBrandingWireBody(this.cwd, data);

  /**
   * Zod shape + env refs, then the authoritative template validation from
   * `@zitadel/config/template` — the LiquidJS-dialect check the Go server
   * cannot run (its save gate is lexical; see ADR 040).
   */
  validate(data: object): void {
    const result = brandingConfigSchema.safeParse(data);
    if (!result.success) {
      throw new ZitadelError("E_VALIDATION", "Branding file is not a valid branding descriptor", {
        details: { issues: result.error.issues },
      });
    }
    assertEnvRefs(data, this.env);
    const template = readDescriptorTemplate(this.cwd, data);
    if (template === undefined) {
      return;
    }
    const issues = validateLoginTemplate(template).filter((issue) => issue.severity === "error");
    if (issues.length > 0) {
      throw new ZitadelError("E_VALIDATION", "Login template failed validation", {
        details: { issues },
        hint: "Fix the template issues; the rules live in docs/design/flowengine/template-security.md.",
      });
    }
  }

  /**
   * `POST /branding` publishes a new immutable revision. The canonical body
   * is converted back to descriptor form: the stored template is written to
   * the referenced `.liquid` file (when it differs) and the JSON keeps the
   * file reference, so `writeBackResource` stays pure-JSON.
   */
  async create(data: object): Promise<{ id: string; canonical?: object }> {
    const wire = toBrandingWireBody(this.cwd, data) as CreateBrandingBody;
    const result = (await this.client.createBranding(wire, {
      project_id: this.projectId,
    })) as CreateBranding201;
    return { id: result.id, canonical: this.canonicalToLocal(result.branding as object, data) };
  }

  async update(_id: string, _data: object): Promise<{ canonical?: object }> {
    throw new ZitadelError(
      "E_NOT_IMPLEMENTED",
      "branding is revisioned — edit publishes a new revision, not an update",
    );
  }

  async delete(id: string): Promise<void> {
    // Branding revisions are immutable on the platform; removing the local
    // descriptor does not retire them. The newest revision keeps being
    // served — publish a new revision to change what users see.
    throw new ZitadelError("E_NOT_IMPLEMENTED", `branding delete is not supported (${id})`);
  }

  /** Wire form (template inlined); diffs compare in the normalized form. Flat-by-id: no project_id query. */
  async fetch(id: string): Promise<object> {
    const envelope = (await this.client.getBrandingById(id)) as GetBrandingById200;
    return envelope.branding as object;
  }

  private canonicalToLocal(canonicalWire: object, localData: object): object {
    const local = localData as { liquid_template_file?: unknown };
    const template = (canonicalWire as { liquid_template?: unknown }).liquid_template;
    if (typeof local.liquid_template_file === "string" && typeof template === "string") {
      const path = resolveTemplatePath(this.cwd, local.liquid_template_file);
      if (readDescriptorTemplate(this.cwd, localData) !== template) {
        writeFileSync(path, template);
        consola.info(`Updated ${local.liquid_template_file} from the server's canonical response`);
      }
    }
    return toLocalBrandingBody(canonicalWire, localData);
  }
}
