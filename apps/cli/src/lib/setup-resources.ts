import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  DEFAULT_BRANDING_CONFIG_PATH,
  DEFAULT_BRANDING_TEMPLATE_PATH,
  DEFAULT_FLOW_CONFIG_PATH,
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

import { BRANDING_DIR } from "./branding";
import { FLOWS_DIR } from "./flows";
import { stableStringify } from "./json";
import { normalizePublicCliProse } from "./public-cli";
import { SCHEMAS_DIR } from "./user-schema";
import { ZitadelError } from "./errors";

export type MaterializeSetupResourcesResult = {
  filesWritten: string[];
};

/**
 * Scaffolds the versioned local default resources for a new project under
 * `.zitadel/`: the user schema, the login flow, optionally a branding design,
 * and the folder READMEs. Files only — nothing is uploaded here. The first
 * release setup builds right after (`POST /configuration-releases`) mints the
 * revisions on every project the app uses and records their ids in
 * `.zitadel/state.json`, exactly as a later `zitadel deploy` would.
 *
 * The flow references its schema by handle (the schema's `objectType`); the
 * release constructor resolves it to the schema revision pinned in the same
 * release, so the files are portable across projects.
 */
export async function materializeSetupResources(opts: {
  cwd: string;
  force: boolean;
  /** Sign-in preset (flow + auth methods) to scaffold; defaults to password-first. */
  preset?: SetupPreset;
  /** Use case (schema field set) to scaffold; defaults to minimal. */
  useCase?: SetupUseCase;
  /**
   * Login design to eject into `.zitadel/branding/`. When absent, no branding
   * files are scaffolded and the login renders the built-in template (the
   * `branding eject` command opts in later).
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
    objectType?: string;
  } & Record<string, unknown>;
  void _templateId;
  const schemaHandle = requiredString(schemaBody.objectType, "default schema objectType");

  if (await writeResourceFile(opts.cwd, DEFAULT_SCHEMA_CONFIG_PATH, schemaBody, opts.force)) {
    filesWritten.push(join(opts.cwd, DEFAULT_SCHEMA_CONFIG_PATH));
  }

  const flowBody = getDefaultLoginFlow({ userSchemaUrl: schemaHandle, preset, useCase });
  if (await writeResourceFile(opts.cwd, DEFAULT_FLOW_CONFIG_PATH, flowBody, opts.force)) {
    filesWritten.push(join(opts.cwd, DEFAULT_FLOW_CONFIG_PATH));
  }

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
  throw new ZitadelError("E_VALIDATION", `Missing ${label}.`);
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
