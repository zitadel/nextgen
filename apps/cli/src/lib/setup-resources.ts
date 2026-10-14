import { access, mkdir, writeFile } from "node:fs/promises";
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
import {
  type ConnectionEndpoints,
  type ConnectionSlug,
  type ProviderSelection,
  providerOf,
  selectionName,
} from "@zitadel/config/idp";
import { normalizeFlowBody, normalizeSchemaBody } from "@zitadel/config/normalize";

import { FLOWS_DIR } from "./flows";
import {
  applySsoToFlow,
  applySsoToSchema,
  authMethods,
  CONNECTION_SCHEMA_REF,
  customFlagText,
  ENABLE_FLAG_NAMES,
  SETUP_FLAG_NAMES,
  IDPS_DIR,
  planConnection,
  readConnectionFiles,
  refuseResolvedSecret,
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
 * `POST /schemas`. The flow names the schema by its `objectType`, but is
 * published after it because the server refuses a flow naming no schema.
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
  /**
   * The providers to enable, in the order they were chosen. One connection is
   * created per entry, and every slug is added to the schema and the flow.
   */
  sso?: readonly { selection: ProviderSelection; endpoints?: ConnectionEndpoints }[];
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
  const schemaTemplate = defaultSchemaTemplate(preset, useCase);

  // The connection goes first, and is created before the schema and flow that
  // name its slug: a Project should never be published claiming a provider the
  // platform does not hold. Its claim mapping reads the template's properties,
  // which enabling the provider does not change.
  // Every file is checked before the first create, the schema and flow too.
  // Checking as each one is written would refuse "before anything is created"
  // only for the first: a conflict later on would leave a connection created
  // on the platform, its file written and its state recorded, and setup does
  // not remove a connection file it wrote -- so the retry would then refuse
  // on that file too, with nothing but the developer able to clear it. One
  // pass to build and refuse, a second to create. Setup runs the same pass
  // before it creates the project, through assertNoSetupResourceConflicts.
  const planned = planConnections(schemaTemplate, opts.sso);
  await refuseResourceConflicts(opts.cwd, opts.force, planned);

  const slugs = planned.map((entry) => entry.slug);
  for (const { connectionPath, connection, selection } of planned) {
    // The create comes before the file. Setup does not remove a connection
    // file it wrote -- that rule is what keeps a developer's own file safe --
    // so writing first would leave one behind on any failure here and the
    // retry would then refuse on it, with nothing able to clear it but the
    // developer. Creating first means a failure leaves nothing to clear.
    //
    // `client_secret` travels as its `${{ NAME }}` reference: the platform
    // resolves it from the environment's variables, so no credential is sent
    // here and none is written to the file.
    const created = await opts.client.createIdp(
      { idp: connection as CreateIdpBodyIdp },
      { project_id: opts.projectId },
    );

    await mkdir(join(opts.cwd, IDPS_DIR), { recursive: true });
    // Still `wx` rather than `opts.force`: the check above is the early
    // refusal, this is the one that cannot be raced.
    if (
      await writeResourceFile(
        opts.cwd,
        connectionPath,
        connection,
        false,
        connectionExists(selection),
      )
    ) {
      filesWritten.push(join(opts.cwd, connectionPath));
    }
    // The same guard the syncer applies: this write puts the canonical body
    // into a file the developer commits, so a resolved secret must stop here
    // rather than land on disk.
    const canonical = (created.definition ?? connection) as object;
    refuseResolvedSecret(canonical, requiredString(created.id, "created connection id"));
    const written = await writeBackResource(opts.cwd, connectionPath, {}, canonical);
    await updateState(opts.cwd, connectionPath, {
      id: requiredString(created.id, "created identity provider connection id"),
      hash: written.hash,
    });
  }

  // Each slug in turn: the edits are additive and idempotent, so folding them
  // builds one schema that names every chosen provider.
  const schemaBody = slugs.reduce<Record<string, unknown>>(
    (document, slug) => applySsoToSchema(document, slug).document as Record<string, unknown>,
    schemaTemplate,
  );

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

  const flowTemplate = getDefaultLoginFlow({ preset, useCase });
  // The conflict step the provider needs can only offer what this schema
  // actually enables, so the methods are read back off the composed document
  // rather than inferred from the preset.
  const flowBody = slugs.reduce<typeof flowTemplate>(
    (document, slug) =>
      applySsoToFlow(document, slug, authMethods(schemaBody)).document as typeof flowTemplate,
    flowTemplate,
  );

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
 * Throws the `E_CONFLICT` {@link materializeSetupResources} would throw on a
 * file it refuses to write: the default schema or flow without `force`, or a
 * connection for one of the chosen providers, which it never replaces.
 *
 * Setup calls this before it creates the project. Those files are written
 * only once the project exists, so a conflict found there leaves the project
 * behind, and a rerun keeps its id and secret in `.env.local`: setup merges
 * only the keys that file is missing.
 */
export async function assertNoSetupResourceConflicts(opts: {
  cwd: string;
  force: boolean;
  preset?: SetupPreset;
  useCase?: SetupUseCase;
  sso?: readonly { selection: ProviderSelection; endpoints?: ConnectionEndpoints }[];
}): Promise<void> {
  const schemaTemplate = defaultSchemaTemplate(
    opts.preset ?? DEFAULT_SETUP_PRESET,
    opts.useCase ?? DEFAULT_SETUP_USE_CASE,
  );
  await refuseResourceConflicts(opts.cwd, opts.force, planConnections(schemaTemplate, opts.sso));
}

/** The default human user schema for a preset and use case, without the template's `$id`. */
function defaultSchemaTemplate(
  preset: SetupPreset,
  useCase: SetupUseCase,
): Record<string, unknown> {
  const { $id: _templateId, ...schemaTemplate } = getDefaultHumanUserSchema({
    preset,
    useCase,
  }) as { $id?: string } & Record<string, unknown>;
  void _templateId;
  return schemaTemplate;
}

type PlannedConnection = {
  slug: ConnectionSlug;
  connectionPath: string;
  connection: object;
  selection: ProviderSelection;
};

/** The connection each chosen provider gets, and the file it is written to. */
function planConnections(
  schemaTemplate: Record<string, unknown>,
  sso: readonly { selection: ProviderSelection; endpoints?: ConnectionEndpoints }[] | undefined,
): PlannedConnection[] {
  const planned: PlannedConnection[] = [];
  for (const chosen of sso ?? []) {
    const provider = providerOf(chosen.selection);
    const connection = provider.connection({
      endpoints: chosen.endpoints,
      schemaProperties: Object.keys((schemaTemplate.properties as object | undefined) ?? {}),
      schemaRef: CONNECTION_SCHEMA_REF,
    });
    planned.push({
      slug: provider.slug,
      connectionPath: `${IDPS_DIR}/${provider.slug}.json`,
      connection,
      selection: chosen.selection,
    });
  }
  return planned;
}

/**
 * Throws on the first file setup would refuse to write. A connection is
 * refused with or without `force`, for two reasons: the file is the
 * developer's (see {@link connectionExists}), and finding out after the
 * create would leave the project holding a connection no local file tracks.
 *
 * The same questions `sso enable` asks: which file holds the slug, and whose
 * variables would collide. A plan that throws names the conflict; one that
 * says reuse means a connection file already holds this provider.
 */
async function refuseResourceConflicts(
  cwd: string,
  force: boolean,
  connections: readonly PlannedConnection[],
): Promise<void> {
  // Read only when a provider was chosen: a leftover file that does not parse
  // is no reason for a plain setup to fail.
  const files = connections.length > 0 ? await readConnectionFiles(cwd) : [];
  for (const { connectionPath, selection } of connections) {
    const existing = planConnection({ selection, files, slugFlag: SETUP_FLAG_NAMES.slug });
    if (existing.action === "reuse" || (await exists(join(cwd, connectionPath)))) {
      throw resourceExists(
        existing.action === "reuse" ? existing.file.path : connectionPath,
        connectionExists(selection),
      );
    }
  }
  if (force) {
    return;
  }
  for (const path of [DEFAULT_SCHEMA_CONFIG_PATH, DEFAULT_FLOW_CONFIG_PATH]) {
    if (await exists(join(cwd, path))) {
      throw resourceExists(path);
    }
  }
}

/**
 * Write a README file, but never overwrite an existing one. A developer who
 * has edited the README should keep their edits when `setup --force` is
 * re-run.
 */
async function writeReadmeFile(cwd: string, relPath: string, content: string): Promise<boolean> {
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
 * What to do about a connection file setup will not touch.
 *
 * Setup neither replaces nor removes one, with or without `--force`: a
 * connection may hold a client id someone registered with the vendor and a slug
 * the schemas and flows already name, and the IdP contract makes these files
 * tenant-owned. So the one rule is that setup does not write there, and the
 * developer decides what happens to the file.
 */
function connectionExists(selection: ProviderSelection): { hint: string; nextCommands: string[] } {
  return {
    hint:
      "A connection file is yours to keep, so setup never replaces or removes one. " +
      "Remove it and run setup again to scaffold a fresh one, or keep it and enable the " +
      "provider afterwards to reuse it.",
    nextCommands: [
      `zitadel sso enable --provider ${selectionName(selection)}${
        selection.kind === "custom"
          ? ` ${customFlagText(selection.connection, ENABLE_FLAG_NAMES)}`
          : ""
      }`,
    ],
  };
}

/** Whether a path is there, without caring why it is not. */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeResourceFile(
  cwd: string,
  relPath: string,
  body: object,
  force: boolean,
  onExists?: { hint: string; nextCommands?: string[] },
): Promise<boolean> {
  const contents = `${stableStringify(body)}\n`;
  try {
    await writeFile(join(cwd, relPath), contents, force ? undefined : { flag: "wx" });
    return true;
  } catch (error) {
    if (isErrno(error, "EEXIST")) {
      throw resourceExists(relPath, onExists);
    }
    throw error;
  }
}

function resourceExists(
  relPath: string,
  onExists?: { hint: string; nextCommands?: string[] },
): ZitadelError {
  return new ZitadelError("E_CONFLICT", `${relPath} already exists`, {
    hint:
      onExists?.hint ??
      "Move the file aside or rerun setup with --force if you want setup to replace it.",
    nextCommands: onExists?.nextCommands,
  });
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
