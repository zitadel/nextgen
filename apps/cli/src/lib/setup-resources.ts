import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { CreateIdpBodyIdp, PublishPolicy201 } from "@zitadel/api/generated/model";
import type { ZitadelClient } from "./api-client";
import {
  DEFAULT_FLOW_CONFIG_PATH,
  DEFAULT_FLOW_SCHEMA_URI,
  DEFAULT_SCHEMA_CONFIG_PATH,
  DEFAULT_SETUP_PRESET,
  DEFAULT_SETUP_USE_CASE,
  flowsReadmeContent,
  getDefaultHumanUserSchemaBody,
  getDefaultLoginFlow,
  policiesReadmeContent,
  schemasReadmeContent,
  type SetupPreset,
  type SetupUseCase,
  type UserSchemaDocument,
} from "@zitadel/config/defaults";
import {
  type ConnectionEndpoints,
  type ConnectionSlug,
  type ProviderSelection,
  providerOf,
  uniquePropertyNames,
} from "@zitadel/config/idp";
import {
  normalizeFlowBody,
  normalizeIdpBody,
  normalizeSchemaBody,
} from "@zitadel/config/normalize";
import { policyConfigSchema } from "@zitadel/config/schemas";

import { FLOWS_DIR } from "./flows";
import {
  PASSWORD_POLICY_OPERATION,
  PASSWORD_POLICY_PATH,
  type PasswordMinLength,
  POLICIES_DIR,
  type PolicyFile,
  passwordPolicyFile,
  toPolicyWireBody,
} from "./policies";
import {
  applySsoToFlow,
  applySsoToSchema,
  authMethods,
  CONNECTION_SCHEMA_REF,
  SETUP_FLAG_NAMES,
  IDPS_DIR,
  planConnection,
  readConnectionFiles,
  ssoEnableArgs,
} from "./idp";
import { stableStringify } from "./json";
import { normalizePublicCliProse } from "./public-cli";
import { hashForState } from "./sync";
import { updateState } from "./sync/state";
import { SCHEMAS_DIR } from "./user-schema";
import { isMissingEndpoint, ZitadelError } from "./errors";
import { type SuggestedCommand, unscopedCommand } from "./suggestion";
import { reportWarning } from "./warnings";

export type MaterializeSetupResourcesResult = {
  filesWritten: string[];
  /**
   * Whether the password policy setup published has a minimum length. A kept
   * policy file decides that as much as the answers do: one without
   * `min_length` keeps none when none was given. `false` when nothing was
   * published.
   */
  passwordMinLengthSet: boolean;
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
   * The minimum password length to put into the password policy: a number,
   * `null` for an explicit none, or `undefined` when none was given. The
   * policy is written and published either way. A new one gets the
   * recommended minimum when none was given, and an empty `config`, which
   * enforces nothing, for none; a kept file keeps its `min_length` only when
   * none was given.
   */
  passwordMinLength?: PasswordMinLength;
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
  const schemaTemplate = getDefaultHumanUserSchemaBody({ preset, useCase });

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
    // The file stays as written: the stored connection spells out defaults
    // the file leaves to the server, and `plan` reads those as no change.
    await updateState(opts.cwd, connectionPath, {
      id: created.id,
      hash: hashForState({ normalize: normalizeIdpBody }, connection),
    });
  }

  // Each slug in turn: the edits are additive and idempotent, so folding them
  // builds one schema that names every chosen provider.
  const schemaBody = slugs.reduce(
    (document, slug) => applySsoToSchema(document, slug).document,
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

  const schema = await opts.client.createSchema(schemaBody, {
    project_id: opts.projectId,
  });
  await updateState(opts.cwd, DEFAULT_SCHEMA_CONFIG_PATH, {
    id: schema.id,
    hash: hashForState({ normalize: normalizeSchemaBody }, schemaBody),
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

  const flow = await opts.client.createFlowDefinition({
    project_id: opts.projectId,
    schema_uri: DEFAULT_FLOW_SCHEMA_URI,
    flow_definition: flowBody,
  });

  await updateState(opts.cwd, DEFAULT_FLOW_CONFIG_PATH, {
    id: flow.id,
    hash: hashForState({ normalize: normalizeFlowBody }, flowBody),
    name: flowBody.name,
    status: flowBody.status,
  });

  // The password policy, created before its file like the connections. A new
  // one gets the recommended minimum unless the developer gave another or
  // none. A policy file already there (only with --force: without it the
  // conflict check refused it) holds a project's chosen rules, so it is kept
  // and published as it is; a minimum given now goes into it.
  const kept = opts.force ? await readPasswordPolicyFile(opts.cwd) : undefined;
  const policy =
    kept === undefined
      ? passwordPolicyFile(opts.passwordMinLength)
      : withMinLength(kept, opts.passwordMinLength);
  let published: PublishPolicy201 | undefined;
  try {
    published = await opts.client.publishPolicy(toPolicyWireBody(policy), {
      project_id: opts.projectId,
    });
  } catch (error) {
    if (!isMissingEndpoint(error)) {
      throw error;
    }
    // A server from before operation policies: the project works without
    // one, so setup goes on without the file rather than failing.
    reportWarning(
      "The server has no policy endpoints yet, so setup wrote no password policy. Upgrade the server, then add .zitadel/policies/ and run `zitadel deploy`.",
    );
  }
  if (published !== undefined) {
    await mkdir(join(opts.cwd, POLICIES_DIR), { recursive: true });
    if (
      (kept === undefined || policy !== kept) &&
      (await writeResourceFile(opts.cwd, PASSWORD_POLICY_PATH, policy, opts.force))
    ) {
      filesWritten.push(join(opts.cwd, PASSWORD_POLICY_PATH));
    }
    await updateState(opts.cwd, PASSWORD_POLICY_PATH, {
      id: published.id,
      hash: hashForState({ normalize: (body) => toPolicyWireBody(body as PolicyFile) }, policy),
    });
  }

  const schemasReadme = join(SCHEMAS_DIR, "README.md");
  const flowsReadme = join(FLOWS_DIR, "README.md");
  const policiesReadme = join(POLICIES_DIR, "README.md");
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
  if (
    published !== undefined &&
    (await writeReadmeFile(
      opts.cwd,
      policiesReadme,
      normalizePublicCliProse(policiesReadmeContent(), opts.cliVersion),
    ))
  ) {
    filesWritten.push(join(opts.cwd, policiesReadme));
  }

  return {
    filesWritten,
    passwordMinLengthSet: published !== undefined && policy.config.min_length !== undefined,
  };
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
  const schemaTemplate = getDefaultHumanUserSchemaBody({
    preset: opts.preset ?? DEFAULT_SETUP_PRESET,
    useCase: opts.useCase ?? DEFAULT_SETUP_USE_CASE,
  });
  await refuseResourceConflicts(opts.cwd, opts.force, planConnections(schemaTemplate, opts.sso));
}

type PlannedConnection = {
  slug: ConnectionSlug;
  connectionPath: string;
  connection: object;
  selection: ProviderSelection;
};

/** The connection each chosen provider gets, and the file it is written to. */
function planConnections(
  schemaTemplate: UserSchemaDocument,
  sso: readonly { selection: ProviderSelection; endpoints?: ConnectionEndpoints }[] | undefined,
): PlannedConnection[] {
  const planned: PlannedConnection[] = [];
  for (const chosen of sso ?? []) {
    const provider = providerOf(chosen.selection);
    const connection = provider.connection({
      endpoints: chosen.endpoints,
      schemaProperties: Object.keys(schemaTemplate.properties ?? {}),
      uniqueProperties: uniquePropertyNames(schemaTemplate),
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
 * The same questions `auth-method sso enable` asks: which file holds the slug, and whose
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
    // --force keeps a policy file and publishes it, so a broken one is refused
    // here, before the project is created or anything is written.
    await readPasswordPolicyFile(cwd);
    return;
  }
  for (const path of [DEFAULT_SCHEMA_CONFIG_PATH, DEFAULT_FLOW_CONFIG_PATH]) {
    if (await exists(join(cwd, path))) {
      throw resourceExists(path);
    }
  }
  if (await exists(join(cwd, PASSWORD_POLICY_PATH))) {
    throw resourceExists(PASSWORD_POLICY_PATH, {
      hint: "Rerun setup with --force to keep this policy and publish it to the new project, or move the file aside to start from an empty one.",
    });
  }
}

/**
 * A kept policy file with the minimum setup was given: unchanged when none was
 * given, without `min_length` for an explicit "none", with the new value
 * otherwise. Its other settings stay as the project chose them.
 */
function withMinLength(kept: PolicyFile, minLength: PasswordMinLength | undefined): PolicyFile {
  // Unchanged is the file as it is, so setup neither rewrites nor reports it.
  if (minLength === undefined || (minLength ?? undefined) === kept.config.min_length) {
    return kept;
  }
  const { min_length: _dropped, ...rest } = kept.config;
  void _dropped;
  return { ...kept, config: minLength === null ? rest : { ...rest, min_length: minLength } };
}

/**
 * The password policy file a project already has, or `undefined` when there is
 * none. It must be a valid policy for the password operation: setup publishes
 * it as it is, so a broken one is refused here, before it reaches the server.
 */
async function readPasswordPolicyFile(cwd: string): Promise<PolicyFile | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(cwd, PASSWORD_POLICY_PATH), "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    data = undefined;
  }
  const result = policyConfigSchema.safeParse(data);
  if (!result.success || result.data.operation !== PASSWORD_POLICY_OPERATION) {
    throw new ZitadelError(
      "E_VALIDATION",
      `${PASSWORD_POLICY_PATH} is not a valid password policy`,
      {
        hint: "Setup keeps an existing policy file and publishes it, so fix it against .zitadel/meta/policy.json or move it aside to start from an empty one.",
        details: { file: PASSWORD_POLICY_PATH },
      },
    );
  }
  return data as PolicyFile;
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
function connectionExists(selection: ProviderSelection): {
  hint: string;
  nextCommands: SuggestedCommand[];
} {
  return {
    hint:
      "A connection file is yours to keep, so setup never replaces or removes one. " +
      "Remove it and run setup again to scaffold a fresh one, or keep it and enable the " +
      "provider afterwards to reuse it.",
    // Setup stopped before it created a project, so there is no environment
    // to carry: the retry is for after the developer reruns setup.
    nextCommands: [unscopedCommand(ssoEnableArgs(selection))],
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
  onExists?: { hint: string; nextCommands?: SuggestedCommand[] },
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
  onExists?: { hint: string; nextCommands?: SuggestedCommand[] },
): ZitadelError {
  return new ZitadelError("E_CONFLICT", `${relPath} already exists`, {
    hint:
      onExists?.hint ??
      "Move the file aside or rerun setup with --force if you want setup to replace it.",
    nextCommands: onExists?.nextCommands,
  });
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
