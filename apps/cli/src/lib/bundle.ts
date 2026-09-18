import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { CreateConfigurationReleaseBody } from "@zitadel/api/generated/model";
import { DEFAULT_FLOW_SCHEMA_URI } from "@zitadel/config/defaults";
import { normalizeFlowBody, normalizeSchemaBody } from "@zitadel/config/normalize";

import { BRANDING_DIR, toBrandingWireBody } from "./branding";
import { FLOWS_DIR } from "./flows";
import { hashForState } from "./sync";
import { readState, updateState } from "./sync/state";
import { SCHEMAS_DIR } from "./user-schema";

const execFileAsync = promisify(execFile);

/** The branding descriptor is a singleton at a fixed path. */
const BRANDING_DESCRIPTOR = `${BRANDING_DIR}/branding.json`;

/**
 * A resource read from `.zitadel/` with the handle the server will pin it
 * under: `objectType` for schemas, `name` for flows, `default` for branding.
 */
export type BundledResource = {
  kind: "schema" | "flow_definition" | "branding";
  /** Project-root-relative file path. */
  path: string;
  handle: string;
  /** The body as sent on the wire. */
  body: object;
  /** The content hash `.zitadel/state.json` records for this file. */
  hash: string;
};

export type ConfigurationBundle = {
  body: CreateConfigurationReleaseBody;
  resources: BundledResource[];
};

/**
 * Reads `.zitadel/{schemas,flows,branding}` into the request body of
 * `POST /configuration-releases`.
 *
 * Flow definitions on disk pin their schema by the revision id the last
 * sync recorded; the bundle carries handles instead, so a flow whose
 * `user_schema` matches a local schema's recorded id is rewritten to that
 * schema's `objectType` and the server resolves it against the schemas in
 * the same bundle.
 */
export async function buildConfigurationBundle(cwd: string): Promise<ConfigurationBundle> {
  const state = await readState(cwd);
  const resources: BundledResource[] = [];

  const schemaHandleByID = new Map<string, string>();
  const schemaHandles: string[] = [];
  const schemas: object[] = [];
  for (const [relPath, body] of await readJsonDir(cwd, SCHEMAS_DIR)) {
    const objectType = (body as { objectType?: unknown }).objectType;
    if (typeof objectType !== "string" || objectType === "") {
      continue;
    }
    // Every id this schema file has ever been known by, on any project: a
    // flow file pins whichever one the last sync or deploy wrote.
    const entry = state.resources[relPath];
    for (const known of [
      entry?.id,
      entry?.previousId,
      ...Object.values(entry?.projects ?? {}),
    ]) {
      if (known) schemaHandleByID.set(known, objectType);
    }
    schemaHandles.push(objectType);
    schemas.push(body);
    resources.push({
      kind: "schema",
      path: relPath,
      handle: objectType,
      body,
      hash: hashForState({ normalize: normalizeSchemaBody }, body),
    });
  }

  const flows: object[] = [];
  for (const [relPath, body] of await readJsonDir(cwd, FLOWS_DIR)) {
    const name = (body as { name?: unknown }).name;
    if (typeof name !== "string" || name === "") {
      continue;
    }
    const wire: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    if (typeof wire.user_schema === "string") {
      wire.user_schema = resolveSchemaHandle(wire.user_schema, schemaHandleByID, schemaHandles);
    }
    flows.push(wire);
    resources.push({
      kind: "flow_definition",
      path: relPath,
      handle: name,
      body: wire,
      hash: hashForState({ normalize: normalizeFlowBody }, body),
    });
  }

  const brandings: object[] = [];
  const descriptor = await readJsonFile(join(cwd, BRANDING_DESCRIPTOR));
  if (descriptor) {
    const normalize = (data: object): object => toBrandingWireBody(cwd, data);
    const wire = normalize(descriptor);
    brandings.push(wire);
    resources.push({
      kind: "branding",
      path: BRANDING_DESCRIPTOR,
      handle: "default",
      body: wire,
      hash: hashForState({ normalize }, descriptor),
    });
  }

  const git = await gitMetadata(cwd);
  const body = {
    schemas,
    flow_definitions: flows,
    flow_schema_uri: DEFAULT_FLOW_SCHEMA_URI,
    brandings,
    git_sha: git.sha,
    git_dirty: git.dirty,
  } as unknown as CreateConfigurationReleaseBody;
  return { body, resources };
}

/**
 * Turns a flow's `user_schema` into the handle the bundle pins it under.
 * The file holds whatever id the last sync or deploy wrote, which may be a
 * revision on another project; any id a local schema file was ever known
 * by maps back to that file's `objectType`. An opaque id nothing local
 * answers to, with exactly one local schema, still resolves to it — the
 * file was scaffolded against that schema and only the id went stale.
 * Anything else (a handle already, or a foreign URL) passes through.
 */
function resolveSchemaHandle(
  value: string,
  byID: ReadonlyMap<string, string>,
  handles: readonly string[],
): string {
  const known = byID.get(value);
  if (known) return known;
  if (handles.includes(value)) return value;
  if (/^sch_[A-Za-z0-9]+$/.test(value) && handles.length === 1) return handles[0]!;
  return value;
}

/**
 * Records the revision ids the server pinned back into `.zitadel/state.json`,
 * so `plan` stays empty after a deploy and a later `apply` does not republish
 * what the release already pins. Ids are project-local, so each is also
 * recorded under the project it belongs to.
 */
export async function recordBundleRevisions(
  cwd: string,
  projectId: string,
  resources: ReadonlyArray<BundledResource>,
  revisions: ReadonlyArray<{ kind: string; handle: string; revision_id: string }>,
): Promise<string[]> {
  const updated: string[] = [];
  const state = await readState(cwd);
  for (const revision of revisions) {
    const resource = resources.find(
      (r) => r.kind === revision.kind && r.handle === revision.handle,
    );
    if (!resource) {
      continue;
    }
    const entry: { id: string; hash: string; name?: string; projects: Record<string, string> } = {
      id: revision.revision_id,
      hash: resource.hash,
      projects: {
        ...(state.resources[resource.path]?.projects ?? {}),
        [projectId]: revision.revision_id,
      },
    };
    if (resource.kind === "flow_definition") {
      entry.name = resource.handle;
    }
    await updateState(cwd, resource.path, entry);
    updated.push(resource.path);
  }
  return updated;
}

/** The current branch name, or `undefined` outside a git checkout. */
export async function gitBranch(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
    const branch = stdout.trim();
    return branch === "" || branch === "HEAD" ? undefined : branch;
  } catch {
    return undefined;
  }
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
