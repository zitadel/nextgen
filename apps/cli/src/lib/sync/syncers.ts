import type {
  CreateBranding201,
  CreateBrandingBody,
  CreateFlowDefinition201,
  CreateFlowDefinitionBodyFlowDefinition,
  CreateIdpBodyIdp,
  CreateSchemaBody,
} from "@zitadel/api/generated/model";
import { consola } from "consola";

import type { ZitadelClient } from "@zitadel/api/client";
import { ApiError } from "@zitadel/api/runtime/fetch";
import { DEFAULT_FLOW_SCHEMA_URI } from "@zitadel/config/defaults";
import { isVariableReference } from "@zitadel/config/idp";
import { normalizeFlowBody, normalizeSchemaBody } from "@zitadel/config/normalize";
import {
  brandingConfigSchema,
  flowConfigSchema,
  idpConnectionConfigSchema,
  schemaConfigSchema,
} from "@zitadel/config/schemas";
import { validateLoginTemplate } from "@zitadel/config/template";

import {
  BRANDING_DIR,
  assertNoLegacyTemplateKey,
  readDescriptorTemplate,
  toBrandingWireBody,
  toLocalBrandingBody,
} from "../branding";
import { FLOWS_DIR, flowEnvRefs } from "../flows";
import { IDPS_DIR, refuseResolvedSecret } from "../idp";
import { SCHEMAS_DIR } from "../user-schema";
import { ZitadelError } from "../errors";
import { FatalFetchError } from "./types.js";
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
   * Project root. The branding syncer resolves `$file` references against it
   * when inlining templates for hashing and upload.
   */
  cwd: string;
}): ReadonlyArray<ResourceSyncer> {
  return [
    new SchemaSyncer(opts.client, opts.projectId, opts.env),
    // Before flows: a flow step naming a connection slug is only valid once
    // that connection exists on the platform.
    new IdpConnectionSyncer(opts.client, opts.projectId),
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
/**
 * A mutation response, checked before it is treated as the canonical body.
 *
 * Both write paths return the stored document and the sync loop writes it back
 * to the file on disk, so this is the last point before a resolved secret would
 * be committed.
 */
function canonicalDefinition(definition: object | undefined, id: unknown): object | undefined {
  if (definition === undefined) {
    return undefined;
  }
  refuseResolvedSecret(definition, typeof id === "string" ? id : "the connection");
  return definition;
}

/** The value a Zod issue path points at, or `undefined` when it is absent. */
function valueAt(data: object, path: ReadonlyArray<PropertyKey>): unknown {
  let current: unknown = data;
  for (const key of path) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function assertEnvRefs(data: object, env: EnvLookup): void {
  const missing = flowEnvRefs(data).filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new ZitadelError("E_VALIDATION", `Missing environment variables: ${missing.join(", ")}`);
  }
}

/**
 * Syncs `.zitadel/idps/*.json`, one identity provider connection per file.
 *
 * `mutable` with `revisioned: false`: the connection keeps one id for life and
 * the server files each edit as a revision beneath it, so an edit is an update
 * here rather than a new resource, and nothing that references the slug has to
 * be re-pinned.
 *
 * Deletion is not supported yet (#1013): what should happen to users already
 * linked to a connection is undesigned, so a removed file is reported and no
 * deletion is sent.
 *
 * `fetch` reads the stored connection so an update plans with a field-level
 * diff, as every other resource does. It refuses a body whose `client_secret`
 * is a value rather than a `${{ NAME }}` reference: previews must never print
 * a credential (area 4), and the CLI's own `validate` makes a literal secret
 * unuploadable, so one coming back from a read means the server resolved it
 * and the plan must stop rather than render it.
 */
class IdpConnectionSyncer implements ResourceSyncer {
  readonly kind = "idp";
  readonly directory = IDPS_DIR;
  readonly mutable = true;
  readonly revisioned = false;

  constructor(
    private readonly client: ZitadelClient,
    private readonly projectId: string,
  ) {}

  /**
   * Parse against the generated `CreateIdpBody.idp` Zod, the orval-emitted
   * equivalent of `idp-connection.json`. A literal `client_secret` fails that
   * pattern, so it is caught here and named plainly: it is the one mistake
   * that would publish a credential.
   */
  validate(data: object): void {
    const result = idpConnectionConfigSchema.safeParse(data);
    if (result.success) {
      return;
    }
    // Only a stored value that is not a reference is the mistake this names.
    // A missing or wrongly-typed `client_secret` fails at the same path, and
    // telling someone to replace a value with a reference when the field is
    // not there sends them looking for something that does not exist.
    const literalSecret = result.error.issues.some((issue) => {
      if (issue.path.length <= 1 || issue.path[issue.path.length - 1] !== "client_secret") {
        return false;
      }
      const stored = valueAt(data, issue.path);
      return typeof stored === "string" && !isVariableReference(stored);
    });
    throw new ZitadelError(
      "E_VALIDATION",
      literalSecret
        ? "Connection file's client_secret must reference a variable, not hold a value"
        : "Connection file is not a valid identity provider connection",
      {
        hint: literalSecret
          ? 'Use "client_secret": "${{ NAME }}" and publish the value with `variables set NAME --secret`.'
          : undefined,
        details: { issues: result.error.issues },
      },
    );
  }

  /**
   * `POST /idps` creates the connection when its slug is new to the project.
   * The response carries the stored document, so no follow-up fetch is needed.
   */
  async create(data: object): Promise<{ id: string; canonical?: object }> {
    const result = await this.client.createIdp(
      { idp: data as CreateIdpBodyIdp },
      { project_id: this.projectId },
    );
    // Guarded before it becomes canonical: `writeBackResource` commits the
    // canonical body to `.zitadel/idps/`, so a resolved secret here would be
    // written to a file the developer commits.
    return { id: result.id, canonical: canonicalDefinition(result.definition, result.id) };
  }

  /**
   * The same call: a document whose slug already exists revises that
   * connection, keeping its id. The id is passed for the sync loop's benefit
   * and deliberately unused — the slug inside the document addresses the row.
   */
  async update(_id: string, data: object): Promise<{ id?: string; canonical?: object }> {
    const result = await this.client.createIdp(
      { idp: data as CreateIdpBodyIdp },
      { project_id: this.projectId },
    );
    // The id comes back because the slug decides which connection the write
    // landed on: editing it names a different connection, and the server
    // creates one. Returning the id keeps state pointing at that connection
    // rather than the one the slug used to name.
    return {
      id: typeof result.id === "string" ? result.id : undefined,
      canonical: canonicalDefinition(result.definition, result.id),
    };
  }

  /**
   * The stored connection, for the plan's before/after.
   *
   * Comparison-only: the result is rendered, never written back or uploaded,
   * so it is returned as the server states it apart from the secret guard.
   */
  async fetch(id: string): Promise<object> {
    const body = await this.client.getIdpById(id, { project_id: this.projectId });
    const definition = (body.definition ?? {}) as object;
    try {
      refuseResolvedSecret(definition, id);
    } catch (err) {
      // Fatal rather than a fetch that failed: the planner swallows an ordinary
      // failure and plans without a diff, which would turn a server resolving
      // secrets into a silently missing before/after.
      throw new FatalFetchError(err as Error);
    }
    return definition;
  }

  async delete(_id: string): Promise<void> {
    throw new ZitadelError("E_NOT_IMPLEMENTED", "Deleting an identity provider connection is not supported yet", {
      hint: "Restore the file, or remove the connection on the platform once deletion is designed (#1013).",
    });
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
    const body = await this.client.getSchemaById(id);
    return body.schema;
  }

  /** The newest revision of the object type, for `pull`. `revisions: latest` + limit 1 is the one current row. */
  async newestRevision(handle: string): Promise<string | null> {
    const page = await this.client.listSchemas({
      project_id: this.projectId,
      object_type: handle,
      revisions: "latest",
      limit: 1,
    });
    return page.schemas[0]?.id ?? null;
  }

  async localiseReference(reference: string): Promise<{ value: string; warning?: string }> {
    // A schema id is shape-less — a minted `sch_…` value, or the document's
    // `$id`, which may be a URL, a URN or a relative URI (ADR 063). Rather
    // than guess from its shape, resolve it by reading the schema; a 404 means
    // the referenced revision is gone, so the id is kept and the caller warned.
    try {
      const body = (await this.fetch(reference)) as { objectType?: string };
      // A schema may omit objectType, and the server treats such a revision as
      // unpinnable (ADR 063 / release validation). Keep the id and warn rather
      // than silently writing an id that no release can resolve.
      if (typeof body.objectType !== "string" || body.objectType === "") {
        return {
          value: reference,
          warning: `schema ${reference} has no object type to reference it by; kept the id in user_schema.`,
        };
      }
      return { value: body.objectType };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return {
          value: reference,
          warning: `schema ${reference} no longer exists; kept the id in user_schema.`,
        };
      }
      throw error;
    }
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
    const envelope = await this.client.getFlowDefinition(id);

    return envelope.flow_definition as object;
  }

  /** The newest revision of the flow name, for `pull`. The list returns a name's revisions newest first. */
  async newestRevision(handle: string): Promise<string | null> {
    const page = await this.client.listFlowDefinitions({
      project_id: this.projectId,
      name: handle,
      limit: 1,
    });
    return page.flow_definitions[0]?.id ?? null;
  }

  /**
   * A flow's one cross-resource reference is `user_schema`, a schema revision.
   * Hand it to the schema syncer to turn the id into the schema's handle.
   */
  async localise(
    serverBody: object,
    syncers: ReadonlyArray<ResourceSyncer>,
  ): Promise<{ body: object; warnings: string[] }> {
    const schema = syncers.find((syncer) => syncer.kind === "schema");
    const reference = (serverBody as { user_schema?: unknown }).user_schema;
    if (schema?.localiseReference === undefined || typeof reference !== "string") {
      return { body: serverBody, warnings: [] };
    }
    const { value, warning } = await schema.localiseReference(reference);
    return {
      body: { ...serverBody, user_schema: value },
      warnings: warning === undefined ? [] : [warning],
    };
  }
}

/**
 * Branding revisions (ADR 040): schema-style immutable semantics — every
 * edit publishes a new revision via `POST /branding`, no update or delete.
 * Unlike schemas, nothing references branding revisions, so a revise never
 * triggers re-pinning. The descriptor keeps the template in a sibling
 * `.liquid` file behind a `$file` reference; this syncer inlines it for
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
    assertNoLegacyTemplateKey(data);
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
    const envelope = await this.client.getBrandingById(id);
    return envelope.branding as object;
  }

  private canonicalToLocal(canonicalWire: object, localData: object): object {
    const { document, written } = toLocalBrandingBody(this.cwd, canonicalWire, localData);
    for (const ref of written) {
      consola.info(`Updated ${ref} from the server's canonical response`);
    }
    return document;
  }
}
