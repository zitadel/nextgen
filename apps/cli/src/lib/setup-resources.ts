import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  CreateFlowDefinition201,
  CreateSchema201,
} from "@zitadel/api/generated/model";
import type { ZitadelClient } from "@zitadel/api/client";
import {
  DEFAULT_FLOW_CONFIG_PATH,
  DEFAULT_FLOW_SCHEMA_URI,
  DEFAULT_SCHEMA_CONFIG_PATH,
  flowsReadmeContent,
  getDefaultHumanUserSchema,
  getDefaultLoginFlow,
  schemasReadmeContent,
} from "@zitadel/config/defaults";

import { FLOWS_DIR } from "./flows";
import { stableStringify } from "./json";
import { hashResourceContent, newSchemaRef } from "./sync";
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
 * The upload sequence is: write the local schema file → `POST /schemas` and
 * capture the server-assigned id → render the flow template with that id as
 * `user_schema` → write it to disk → `POST /flow_definitions`. Flow's
 * `user_schema` can only be filled in after the create call returns.
 */
export async function materializeSetupResources(opts: {
  cwd: string;
  client: ZitadelClient;
  projectId: string;
  force: boolean;
}): Promise<MaterializeSetupResourcesResult> {
  await mkdir(join(opts.cwd, FLOWS_DIR), { recursive: true });
  await mkdir(join(opts.cwd, SCHEMAS_DIR), { recursive: true });

  const filesWritten: string[] = [];

  const schemaBody = getDefaultHumanUserSchema();

  const schemaWritten = await writeResourceFile(
    opts.cwd,
    DEFAULT_SCHEMA_CONFIG_PATH,
    schemaBody,
    opts.force,
  );
  if (schemaWritten) {
    filesWritten.push(join(opts.cwd, DEFAULT_SCHEMA_CONFIG_PATH));
  }

  const schemaRef = newSchemaRef(opts.projectId);
  const schema = (await opts.client.createSchema(
    { ...schemaBody, $id: schemaRef },
    { project_id: opts.projectId },
  )) as CreateSchema201;
  const schemaId = requiredString(schema.id, "created schema id");
  await updateState(opts.cwd, DEFAULT_SCHEMA_CONFIG_PATH, {
    id: schemaId,
    hash: hashWrittenBody(schemaBody),
  });

  const flowBody = getDefaultLoginFlow({ userSchemaRef: schemaId });

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

  await updateState(opts.cwd, DEFAULT_FLOW_CONFIG_PATH, {
    id: requiredString(flow.id, "created flow definition id"),
    hash: hashWrittenBody(flowBody),
    name: flowBody.name,
    status: flow.status,
  });

  const schemasReadme = join(SCHEMAS_DIR, "README.md");
  const flowsReadme = join(FLOWS_DIR, "README.md");
  if (await writeReadmeFile(opts.cwd, schemasReadme, schemasReadmeContent())) {
    filesWritten.push(join(opts.cwd, schemasReadme));
  }
  if (await writeReadmeFile(opts.cwd, flowsReadme, flowsReadmeContent())) {
    filesWritten.push(join(opts.cwd, flowsReadme));
  }

  return { filesWritten };
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

function hashWrittenBody(body: object): string {
  // Match the exact normalized JSON shape written to disk so setup-seeded
  // state is immediately comparable with the sync planner.
  return hashResourceContent(JSON.parse(stableStringify(body)) as object);
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
