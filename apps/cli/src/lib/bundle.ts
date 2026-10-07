import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { CreateReleaseBody } from "@zitadel/api/generated/model";
import { DEFAULT_FLOW_SCHEMA_URI } from "@zitadel/config/defaults";

import { BRANDING_DIR, toBrandingWireBody } from "./branding";
import { FLOWS_DIR } from "./flows";
import { SCHEMAS_DIR } from "./user-schema";

const execFileAsync = promisify(execFile);

/** The branding descriptor is a singleton at a fixed path. */
const BRANDING_DESCRIPTOR = `${BRANDING_DIR}/branding.json`;

/**
 * A resource read from `.zitadel/` with the handle the server pins it under:
 * `objectType` for schemas, `name` for flows, `default` for branding.
 */
export type BundledResource = {
  kind: "schema" | "flow_definition" | "branding";
  /** Project-root-relative file path. */
  path: string;
  handle: string;
};

export type ConfigurationBundle = {
  body: CreateReleaseBody;
  resources: BundledResource[];
};

/**
 * Reads `.zitadel/{schemas,flows,branding}` into the `bundle` form of
 * `POST /releases`. Nothing local is consulted for ids: the
 * server compares content against the project's newest revisions, so the
 * same directory builds the same release on any project.
 *
 * Flow definitions on disk pin their schema by whatever revision id was
 * written into the file; the bundle carries handles instead, so an id that a
 * local schema file answers to is rewritten to that schema's `objectType`.
 */
export async function buildConfigurationBundle(cwd: string): Promise<ConfigurationBundle> {
  const resources: BundledResource[] = [];

  const schemaHandleByID = new Map<string, string>();
  const schemaHandles: string[] = [];
  const schemas: object[] = [];
  const knownIDs = await schemaIDsFromState(cwd);
  for (const [relPath, body] of await readJsonDir(cwd, SCHEMAS_DIR)) {
    const objectType = (body as { objectType?: unknown }).objectType;
    if (typeof objectType !== "string" || objectType === "") {
      continue;
    }
    const id = (body as { $id?: unknown }).$id;
    for (const known of [typeof id === "string" ? id : undefined, ...(knownIDs.get(relPath) ?? [])]) {
      if (known) schemaHandleByID.set(known, objectType);
    }
    schemaHandles.push(objectType);
    schemas.push(body);
    resources.push({ kind: "schema", path: relPath, handle: objectType });
  }

  const flows: object[] = [];
  for (const [relPath, body] of await readJsonDir(cwd, FLOWS_DIR)) {
    const name = (body as { name?: unknown }).name;
    if (typeof name !== "string" || name === "") {
      continue;
    }
    const { $schema, ...wire } = body as Record<string, unknown>;
    void $schema;
    if (typeof wire.user_schema === "string") {
      wire.user_schema = resolveSchemaHandle(wire.user_schema, schemaHandleByID, schemaHandles);
    }
    flows.push(wire);
    resources.push({ kind: "flow_definition", path: relPath, handle: name });
  }

  const brandings: object[] = [];
  const descriptor = await readJsonFile(join(cwd, BRANDING_DESCRIPTOR));
  if (descriptor) {
    brandings.push(toBrandingWireBody(cwd, descriptor));
    resources.push({ kind: "branding", path: BRANDING_DESCRIPTOR, handle: "default" });
  }

  const git = await gitMetadata(cwd);
  const body = {
    bundle: { schemas, flow_definitions: flows, flow_schema_uri: DEFAULT_FLOW_SCHEMA_URI, brandings },
    ...(git.sha ? { git_sha: git.sha } : {}),
    git_dirty: git.dirty,
  } as unknown as CreateReleaseBody;
  return { body, resources };
}

/**
 * Turns a flow's `user_schema` into the handle the bundle pins it under. An
 * id a local schema file is known by maps to that file's `objectType`. An
 * opaque id nothing local answers to, with exactly one local schema, still
 * resolves to it: the file was scaffolded against that schema and only the
 * id went stale. Anything else (a handle already, or a foreign URL) passes
 * through for the server to resolve.
 */
export function resolveSchemaHandle(
  value: string,
  byID: ReadonlyMap<string, string>,
  handles: readonly string[],
): string {
  const known = byID.get(value);
  if (known) return known;
  if (handles.includes(value)) return value;
  const [only] = handles;
  if (only !== undefined && handles.length === 1 && /^sch_[A-Za-z0-9]+$/.test(value)) return only;
  return value;
}

/**
 * The revision ids `.zitadel/state.json` recorded per schema file, when the
 * file exists. The sync loop keeps it for `plan` and `apply`; here it only
 * widens the id-to-handle map, and a missing or stale file changes nothing.
 */
async function schemaIDsFromState(cwd: string): Promise<Map<string, string[]>> {
  const ids = new Map<string, string[]>();
  const state = await readJsonFile(join(cwd, ".zitadel/state.json"));
  const resources = (state as { resources?: Record<string, unknown> } | undefined)?.resources;
  if (!resources) {
    return ids;
  }
  for (const [path, entry] of Object.entries(resources)) {
    if (!path.startsWith(`${SCHEMAS_DIR}/`) || typeof entry !== "object" || entry === null) {
      continue;
    }
    const { id, previousId } = entry as { id?: unknown; previousId?: unknown };
    ids.set(path, [id, previousId].filter((v): v is string => typeof v === "string"));
  }
  return ids;
}

async function gitMetadata(cwd: string): Promise<{ sha?: string; dirty: boolean }> {
  try {
    const { stdout: sha } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
    const { stdout: status } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
    return { sha: sha.trim() || undefined, dirty: status.trim() !== "" };
  } catch {
    return { dirty: false };
  }
}

async function readJsonDir(cwd: string, dir: string): Promise<Array<[string, object]>> {
  let entries: string[];
  try {
    entries = await readdir(join(cwd, dir));
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
  const out: Array<[string, object]> = [];
  for (const entry of entries.filter((e) => e.endsWith(".json")).sort()) {
    const relPath = `${dir}/${entry}`;
    const body = await readJsonFile(join(cwd, relPath));
    if (body) {
      out.push([relPath, body]);
    }
  }
  return out;
}

async function readJsonFile(path: string): Promise<object | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as object;
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
