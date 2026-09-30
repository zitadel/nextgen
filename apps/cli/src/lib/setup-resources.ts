import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { consola } from "consola";

import type {
  CreateFlowDefinition201,
  CreateIdpBodyIdp,
  CreateSchema201,
  CreateSchemaBody,
} from "@zitadel/api/generated/model";
import type { ZitadelClient } from "@zitadel/api/client";
import {
  DEFAULT_FLOW_CONFIG_PATH,
  DEFAULT_FLOW_SCHEMA_URI,
  DEFAULT_SCHEMA_CONFIG_PATH,
  DEFAULT_SETUP_PRESET,
  DEFAULT_SETUP_USE_CASE,
  flowsReadmeContent,
  getDefaultHumanUserSchema,
  getDefaultLoginFlow,
  schemasReadmeContent,
  type SetupPreset,
  type SetupUseCase,
} from "@zitadel/config/defaults";
import { type ConnectionEndpoints, idpProvider } from "@zitadel/config/idp";
import { normalizeFlowBody, normalizeSchemaBody } from "@zitadel/config/normalize";

import { FLOWS_DIR } from "./flows";
import {
  applySsoToFlow,
  applySsoToSchema,
  authMethods,
  CONNECTION_SCHEMA_REF,
  IDPS_DIR,
} from "./idp";
import { stableStringify } from "./json";
import { normalizePublicCliProse } from "./public-cli";
import { hashForState, writeBackResource } from "./sync";
import { updateState } from "./sync/state";
import { SCHEMAS_DIR } from "./user-schema";
import { ZitadelError } from "./errors";

export type MaterializeSetupResourcesResult = {
  filesWritten: string[];
};

/**
 * Scaffolds the versioned local default resources for a new project, uploads
 * them through the schema/flow APIs, and seeds `.zitadel/state.json` with the
 * IDs, hashes, and flow metadata the sync engine expects. Setup calls this only
 * after the framework patcher has created `.zitadel/{flows,schemas}` and the
 * initial state file.
 *
 * The schema is uploaded without an `$id`: the server assigns an opaque id on
 * `POST /schemas`, and the flow file can only be rendered after that id comes
 * back because `flow_definition.user_schema` must reference it.
 */
export async function materializeSetupResources(opts: {
  cwd: string;
  client: ZitadelClient;
  projectId: string;
  force: boolean;
  /** Sign-in preset (flow + auth methods) to scaffold; defaults to password-first. */
  preset?: SetupPreset;
  /** Use case (schema field set) to scaffold; defaults to minimal. */
  useCase?: SetupUseCase;
  /**
   * Social provider to enable while scaffolding. Its connection is written
   * and created before the schema and flow that reference it, so the Project
   * is never published naming a provider the platform does not hold.
   */
  sso?: { provider: string; clientId: string; endpoints?: ConnectionEndpoints };
  /**
   * CLI version used to render `zitadel …` command mentions in the scaffolded
   * READMEs as runnable `npx @zitadel/cli@<version> …` commands — the CLI is
   * not a dependency of the generated app, so the bare command doesn't exist
   * there.
   */
  cliVersion: string;
}): Promise<MaterializeSetupResourcesResult> {
  await mkdir(join(opts.cwd, FLOWS_DIR), { recursive: true });
  await mkdir(join(opts.cwd, SCHEMAS_DIR), { recursive: true });

  const filesWritten: string[] = [];
  const preset = opts.preset ?? DEFAULT_SETUP_PRESET;
  const useCase = opts.useCase ?? DEFAULT_SETUP_USE_CASE;

  const { $id: _templateId, ...schemaTemplate } = getDefaultHumanUserSchema({
    preset,
    useCase,
  }) as { $id?: string } & Record<string, unknown>;
  void _templateId;

  // The connection goes first, and is created before the schema and flow that
  // name its slug: a Project should never be published claiming a provider the
  // platform does not hold. Its claim mapping reads the template's properties,
  // which enabling the provider does not change.
  const connection = opts.sso
    ? idpProvider(opts.sso.provider).connection({
        endpoints: opts.sso.endpoints,
        schemaProperties: Object.keys((schemaTemplate.properties as object | undefined) ?? {}),
        schemaRef: CONNECTION_SCHEMA_REF,
      })
    : undefined;
  const slug = typeof connection?.slug === "string" ? connection.slug : undefined;
  if (connection && slug) {
    await mkdir(join(opts.cwd, IDPS_DIR), { recursive: true });
    const connectionPath = `${IDPS_DIR}/${slug}.json`;
    // Deliberately not `opts.force`. The other scaffolded files are setup's
    // own output, so replacing them is what --force is for; a connection may
    // hold a client id someone registered and a slug the schemas and flows
    // already name, and the IdP contract makes these files tenant-owned.
    // `sso enable` reuses one instead of rewriting it, and setup must not be
    // the one command that silently does otherwise.
    if (await writeResourceFile(opts.cwd, connectionPath, connection, false, CONNECTION_EXISTS_HINT)) {
      filesWritten.push(join(opts.cwd, connectionPath));
    }
    // `client_secret` travels as its `${{ NAME }}` reference: the platform
    // resolves it from the environment's variables, so no credential is sent
    // here and none is written to the file.
    const created = await opts.client.createIdp(
      { idp: connection as CreateIdpBodyIdp },
      { project_id: opts.projectId },
    );
    const written = await writeBackResource(
      opts.cwd,
      connectionPath,
      {},
      (created.definition ?? connection) as object,
    );
    await updateState(opts.cwd, connectionPath, {
      id: requiredString(created.id, "created identity provider connection id"),
      hash: written.hash,
    });
  }

  const schemaBody = slug
    ? (applySsoToSchema(schemaTemplate, slug).document as Record<string, unknown>)
    : schemaTemplate;

  const schemaWritten = await writeResourceFile(
    opts.cwd,
    DEFAULT_SCHEMA_CONFIG_PATH,
    schemaBody,
    opts.force,
  );
  if (schemaWritten) {
    filesWritten.push(join(opts.cwd, DEFAULT_SCHEMA_CONFIG_PATH));
  }

  const schema = (await opts.client.createSchema(schemaBody as CreateSchemaBody, {
    project_id: opts.projectId,
  })) as CreateSchema201;
  const schemaId = requiredString(schema.id, "created schema id");
  // Reconcile the just-written file with the server's stored body so local
  // config matches live state from the first second; a fetch failure keeps
  // the template body and its hash (parity is best-effort at setup).
  let schemaHash = hashForState({ normalize: normalizeSchemaBody }, schemaBody);
  try {
    // The response is the `{id, schema, metadata}` envelope; the local config
    // file keeps only the customer-authored document.
    const canonical = (await opts.client.getSchemaById(schemaId)).schema;
    const written = await writeBackResource(
      opts.cwd,
      DEFAULT_SCHEMA_CONFIG_PATH,
      { normalize: normalizeSchemaBody },
      canonical,
    );
    schemaHash = written.hash;
  } catch (err) {
    consola.debug(`fetch created schema ${schemaId} during setup failed:`, err);
  }
  await updateState(opts.cwd, DEFAULT_SCHEMA_CONFIG_PATH, {
    id: schemaId,
    hash: schemaHash,
  });

  const flowTemplate = getDefaultLoginFlow({ userSchemaUrl: schemaId, preset, useCase });
  // The conflict step the provider needs can only offer what this schema
  // actually enables, so the methods are read back off the composed document
  // rather than inferred from the preset.
  const flowBody = (
    slug ? applySsoToFlow(flowTemplate, slug, authMethods(schemaBody)).document : flowTemplate
  ) as typeof flowTemplate;

  const flowWritten = await writeResourceFile(
    opts.cwd,
    DEFAULT_FLOW_CONFIG_PATH,
    flowBody,
    opts.force,
  );
  if (flowWritten) {
    filesWritten.push(join(opts.cwd, DEFAULT_FLOW_CONFIG_PATH));
  }

  const flow = (await opts.client.createFlowDefinition({
    project_id: opts.projectId,
    schema_uri: DEFAULT_FLOW_SCHEMA_URI,
    flow_definition: flowBody,
  })) as CreateFlowDefinition201;

  let flowHash = hashForState({ normalize: normalizeFlowBody }, flowBody);
  if (flow.flow_definition) {
    const written = await writeBackResource(
      opts.cwd,
      DEFAULT_FLOW_CONFIG_PATH,
      { normalize: normalizeFlowBody, normalizeWrite: normalizeFlowBody },
      flow.flow_definition as object,
    );
    flowHash = written.hash;
  }
  await updateState(opts.cwd, DEFAULT_FLOW_CONFIG_PATH, {
    id: requiredString(flow.id, "created flow definition id"),
    hash: flowHash,
    name: flowBody.name,
    status: flowBody.status,
  });

  const schemasReadme = join(SCHEMAS_DIR, "README.md");
  const flowsReadme = join(FLOWS_DIR, "README.md");
  if (
    await writeReadmeFile(
      opts.cwd,
      schemasReadme,
      normalizePublicCliProse(schemasReadmeContent(), opts.cliVersion),
    )
  ) {
    filesWritten.push(join(opts.cwd, schemasReadme));
  }
  if (
    await writeReadmeFile(
      opts.cwd,
      flowsReadme,
      normalizePublicCliProse(flowsReadmeContent(), opts.cliVersion),
    )
  ) {
    filesWritten.push(join(opts.cwd, flowsReadme));
  }

  return { filesWritten };
}

/**
 * Write a README file, but never overwrite an existing one. A developer who
 * has edited the README should keep their edits when `setup --force` is
 * re-run.
 */
async function writeReadmeFile(
  cwd: string,
  relPath: string,
  content: string,
): Promise<boolean> {
  const dest = join(cwd, relPath);
  await mkdir(dirname(dest), { recursive: true });
  try {
    await writeFile(dest, content, { flag: "wx" });
    return true;
  } catch (error) {
    if (isErrno(error, "EEXIST")) {
      return false;
    }
    throw error;
  }
}

/**
 * The files a failed `setup` should remove, so a rerun starts fresh.
 *
 * `zitadel.json` and `.zitadel/secret` are always setup's own: the
 * already-initialized guard refuses to run when either is present. A
 * connection is only setup's when this run wrote it — one that was already on
 * disk belongs to the developer, and is the likeliest reason the run failed,
 * since {@link materializeSetupResources} refuses to replace one with or
 * without `--force`. Removing that would destroy the file setup just declined
 * to overwrite, which is worse than the overwrite it was protecting against.
 */
export function setupRollbackFiles(options: {
  /** Project-relative connection path, or `undefined` when no provider was chosen. */
  readonly connectionPath?: string;
  /** Whether that connection was on disk before this run started. */
  readonly connectionExisted: boolean;
}): string[] {
  const { connectionPath, connectionExisted } = options;
  return [
    "zitadel.json",
    ".zitadel/secret",
    ...(connectionPath !== undefined && !connectionExisted ? [connectionPath] : []),
  ];
}

/** What to do about a connection file setup refuses to replace. */
const CONNECTION_EXISTS_HINT =
  "A connection file is yours to keep, so setup will not replace it -- not even with --force. " +
  "Remove it to scaffold a new one, or run `zitadel sso enable` afterwards to reuse it.";

async function writeResourceFile(
  cwd: string,
  relPath: string,
  body: object,
  force: boolean,
  existsHint?: string,
): Promise<boolean> {
  const contents = `${stableStringify(body)}\n`;
  try {
    await writeFile(join(cwd, relPath), contents, force ? undefined : { flag: "wx" });
    return true;
  } catch (error) {
    if (isErrno(error, "EEXIST")) {
      throw new ZitadelError("E_CONFLICT", `${relPath} already exists`, {
        hint:
          existsHint ??
          "Move the file aside or rerun setup with --force if you want setup to replace it.",
      });
    }
    throw error;
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new ZitadelError("E_VALIDATION", `Missing ${label} in server response.`);
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
