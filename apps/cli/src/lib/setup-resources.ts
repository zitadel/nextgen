import { mkdir, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";

import type {
  CreateFlowDefinitionBodyFlowDefinition,
  GetFlowDefinition200,
  GetSchemaById200,
  ListFlowDefinitions200,
  ListFlowDefinitions200FlowDefinitionsItem,
} from "@zitadel/api/generated/model";
import type { ZitadelClient } from "@zitadel/api/client";

import { FLOWS_DIR } from "./flows";
import { isObject, stableStringify } from "./json";
import { hashResourceContent } from "./sync";
import { updateState } from "./sync/state";
import { SCHEMAS_DIR } from "./user-schema";
import { ZitadelError } from "./errors";

export type MaterializeSetupResourcesResult = {
  filesWritten: string[];
};

/**
 * Pulls the server-provisioned editable resources for a new project into the
 * local GitOps config surface and seeds `.zitadel/state.json` with the IDs and
 * hashes the sync engine expects. Setup calls this only after the framework
 * patcher has created `.zitadel/{flows,schemas}` and the initial state file.
 */
export async function materializeSetupResources(opts: {
  cwd: string;
  client: ZitadelClient;
  projectId: string;
  force: boolean;
}): Promise<MaterializeSetupResourcesResult> {
  await mkdir(join(opts.cwd, FLOWS_DIR), { recursive: true });
  await mkdir(join(opts.cwd, SCHEMAS_DIR), { recursive: true });

  const flowList = (await opts.client.listFlowDefinitions({
    project_id: opts.projectId,
  })) as ListFlowDefinitions200;
  const listedFlows = flowList.flow_definitions ?? [];
  if (listedFlows.length === 0) {
    throw new ZitadelError(
      "E_VALIDATION",
      "The project did not expose any default flow definitions to scaffold.",
      {
        hint: "The server must provide flow definition list/read support before setup can materialize editable flow config.",
      },
    );
  }

  const filesWritten: string[] = [];
  const schemaIds = new Set<string>();

  for (const item of [...listedFlows].sort(compareFlowListItems)) {
    const flowId = requiredString(item.id, "flow definition id");
    const envelope = (await opts.client.getFlowDefinition(flowId, {
      project_id: opts.projectId,
    })) as GetFlowDefinition200;
    const flowDefinition = envelope.flow_definition as CreateFlowDefinitionBodyFlowDefinition;
    if (!isObject(flowDefinition)) {
      throw new ZitadelError(
        "E_VALIDATION",
        `Flow definition ${flowId} did not include an editable body.`,
      );
    }
    const relPath = `${FLOWS_DIR}/${resourceFileName(flowDefinition.name ?? item.name ?? flowId)}`;
    const written = await writeResourceFile(opts.cwd, relPath, flowDefinition, opts.force);
    if (written) {
      filesWritten.push(join(opts.cwd, relPath));
    }
    await updateState(opts.cwd, relPath, {
      id: flowId,
      hash: hashWrittenBody(flowDefinition),
    });

    const userSchema = flowDefinition.user_schema;
    if (typeof userSchema === "string" && userSchema.length > 0) {
      schemaIds.add(userSchema);
    }
  }

  for (const schemaId of [...schemaIds].sort()) {
    const schema = (await opts.client.getSchemaById(encodeURIComponent(schemaId), {
      project_id: opts.projectId,
    })) as GetSchemaById200;
    if (!isObject(schema)) {
      throw new ZitadelError("E_VALIDATION", `Schema ${schemaId} did not include a JSON body.`);
    }
    const relPath = `${SCHEMAS_DIR}/${schemaFileName(schemaId)}`;
    const written = await writeResourceFile(opts.cwd, relPath, schema, opts.force);
    if (written) {
      filesWritten.push(join(opts.cwd, relPath));
    }
    await updateState(opts.cwd, relPath, {
      id: schemaId,
      hash: hashWrittenBody(schema),
    });
  }

  return { filesWritten };
}

function compareFlowListItems(
  left: ListFlowDefinitions200FlowDefinitionsItem,
  right: ListFlowDefinitions200FlowDefinitionsItem,
): number {
  return `${left.name ?? ""}\0${left.id ?? ""}`.localeCompare(
    `${right.name ?? ""}\0${right.id ?? ""}`,
  );
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
  return hashResourceContent(JSON.parse(stableStringify(body)) as object);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new ZitadelError("E_VALIDATION", `Missing ${label} in server response.`);
}

function schemaFileName(schemaId: string): string {
  try {
    const parsed = new URL(schemaId);
    const base = posix.basename(parsed.pathname);
    if (base.endsWith(".json")) {
      return base;
    }
    if (base.length > 0) {
      return resourceFileName(base);
    }
  } catch {
    // Fall through to slugging the raw id.
  }
  return resourceFileName(schemaId);
}

function resourceFileName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "resource"}.json`;
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
