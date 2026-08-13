import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { consola } from "consola";

import type {
  CreateBranding201,
  CreateBrandingBody,
  CreateFlowDefinition201,
  CreateSchema201,
  CreateSchemaBody,
} from "@zitadel/api/generated/model";
import type { ZitadelClient } from "@zitadel/api/client";
import {
  DEFAULT_BRANDING_CONFIG_PATH,
  DEFAULT_BRANDING_TEMPLATE_PATH,
  DEFAULT_FLOW_CONFIG_PATH,
  DEFAULT_FLOW_SCHEMA_URI,
  DEFAULT_SCHEMA_CONFIG_PATH,
  DEFAULT_SETUP_PRESET,
  DEFAULT_SETUP_USE_CASE,
  brandingReadmeContent,
  flowsReadmeContent,
  getDefaultBrandingConfig,
  getDefaultHumanUserSchema,
  getDefaultLoginFlow,
  schemasReadmeContent,
  type SetupPreset,
  type SetupUseCase,
} from "@zitadel/config/defaults";
import { BRANDING_FILE_SCHEMA_REF } from "@zitadel/config/meta-schemas";

import { normalizeFlowBody, normalizeSchemaBody } from "@zitadel/config/normalize";

import { BRANDING_DIR, toBrandingWireBody } from "./branding";
import { FLOWS_DIR } from "./flows";
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
   * Login design to eject into `.zitadel/branding/` and publish as branding
   * revision 1. When absent, no branding files are scaffolded and the login
   * renders the built-in template (the `branding eject` command opts in later).
   */
  design?: string;
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

  const { $id: _templateId, ...schemaBody } = getDefaultHumanUserSchema({ preset, useCase }) as {
    $id?: string;
  } & Record<string, unknown>;
  void _templateId;

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
    const canonical = (await opts.client.getSchemaById(
      encodeURIComponent(schemaId),
    )) as object;
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

  const flowBody = getDefaultLoginFlow({ userSchemaUrl: schemaId, preset, useCase });

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

  if (opts.design) {
    await mkdir(join(opts.cwd, BRANDING_DIR), { recursive: true });
    const { branding, template } = getDefaultBrandingConfig(opts.design);
    const descriptor = { $schema: BRANDING_FILE_SCHEMA_REF, ...branding };

    if (await writeResourceFile(opts.cwd, DEFAULT_BRANDING_CONFIG_PATH, descriptor, opts.force)) {
      filesWritten.push(join(opts.cwd, DEFAULT_BRANDING_CONFIG_PATH));
    }
    if (await writeRawFile(opts.cwd, DEFAULT_BRANDING_TEMPLATE_PATH, template, opts.force)) {
      filesWritten.push(join(opts.cwd, DEFAULT_BRANDING_TEMPLATE_PATH));
    }

    const brandingNormalize = (data: object): object => toBrandingWireBody(opts.cwd, data);
    const created = (await opts.client.createBranding(
      brandingNormalize(descriptor) as CreateBrandingBody,
      { project_id: opts.projectId },
    )) as CreateBranding201;
    await updateState(opts.cwd, DEFAULT_BRANDING_CONFIG_PATH, {
      id: requiredString(created.id, "created branding revision id"),
      hash: hashForState({ normalize: brandingNormalize }, descriptor),
    });

    const brandingReadme = join(BRANDING_DIR, "README.md");
    if (
      await writeReadmeFile(
        opts.cwd,
        brandingReadme,
        normalizePublicCliProse(brandingReadmeContent(), opts.cliVersion),
      )
    ) {
      filesWritten.push(join(opts.cwd, brandingReadme));
    }
  }

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
 * Write a non-JSON scaffold file (the `.liquid` template) with the same
 * conflict semantics as {@link writeResourceFile}: `--force` overwrites,
 * otherwise an existing file is an `E_CONFLICT`.
 */
async function writeRawFile(
  cwd: string,
  relPath: string,
  content: string,
  force: boolean,
): Promise<boolean> {
  const dest = join(cwd, relPath);
  await mkdir(dirname(dest), { recursive: true });
  try {
    await writeFile(dest, content, force ? undefined : { flag: "wx" });
    return true;
  } catch (error) {
    if (isErrno(error, "EEXIST")) {
      throw new ZitadelError("E_CONFLICT", `${relPath} already exists`, {
        hint: "Move the file aside or rerun setup with --force if you want setup to replace it.",
      });
    }
    throw error;
  }
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

async function writeResourceFile(
  cwd: string,
  relPath: string,
  body: object,
  force: boolean,
): Promise<boolean> {
  const contents = `${stableStringify(body)}\n`;
  try {
    await writeFile(join(cwd, relPath), contents, force ? undefined : { flag: "wx" });
    return true;
  } catch (error) {
    if (isErrno(error, "EEXIST")) {
      throw new ZitadelError("E_CONFLICT", `${relPath} already exists`, {
        hint: "Move the file aside or rerun setup with --force if you want setup to replace it.",
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
