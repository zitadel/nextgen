import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  CreateFlowDefinition201,
  CreateSchema201,
  CreateSchemaBody,
} from "@zitadel/api/generated/model";
import type { ZitadelClient } from "@zitadel/api/client";
import {
  DEFAULT_FLOW_CONFIG_PATH,
  DEFAULT_FLOW_SCHEMA_URI,
  DEFAULT_SCHEMA_CONFIG_PATH,
  getDefaultHumanUserSchema,
  getDefaultLoginFlow,
} from "@zitadel/config/defaults";

import { FLOWS_DIR } from "./flows";
import { stableStringify } from "./json";
import { hashResourceContent } from "./sync";
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
}): Promise<MaterializeSetupResourcesResult> {
  await mkdir(join(opts.cwd, FLOWS_DIR), { recursive: true });
  await mkdir(join(opts.cwd, SCHEMAS_DIR), { recursive: true });

  const filesWritten: string[] = [];

  const { $id: _templateId, ...schemaBody } = getDefaultHumanUserSchema() as {
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
  await updateState(opts.cwd, DEFAULT_SCHEMA_CONFIG_PATH, {
    id: schemaId,
    hash: hashWrittenBody(schemaBody),
  });

  const flowBody = getDefaultLoginFlow({ userSchemaUrl: schemaId });

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
    status: flowBody.status,
  });

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
