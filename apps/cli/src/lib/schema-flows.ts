import { isErrno, ZitadelError } from "./errors";
import { isObject } from "./json";
import { readFlowFiles, type FlowFile, type SchemaFile } from "./idp";
import { readState } from "./sync/state";

/**
 * The login flows that run against a user schema.
 *
 * A command that changes a schema has to know which journeys the change
 * reaches: enabling a provider adds it to them, and disabling a sign-in method
 * must not leave one asking for it. A flow belonging to another schema is
 * never returned, so changing customers never touches the employee journey.
 */
export async function flowsForSchema(cwd: string, schema: SchemaFile): Promise<FlowFile[]> {
  const publishedIds = await publishedIdsOf(cwd, schema.path);
  return (await readFlowFiles(cwd)).filter((flow) =>
    flowUsesSchema(flow.body, schema, publishedIds),
  );
}

/**
 * Whether a flow runs against this schema. Flows name it by the URL the
 * schema publishes, so the schema's own `$id` is the reliable link; a Project
 * with one schema and one flow matches on that alone.
 */
function flowUsesSchema(
  flow: Record<string, unknown>,
  schema: SchemaFile,
  publishedIds: readonly string[],
): boolean {
  const used = flow.user_schema;
  if (typeof used !== "string") {
    return false;
  }
  // Once a Project has been applied, the flow names the schema by the id the
  // platform assigned, which `.zitadel/state.json` records against the schema
  // file. Before that it still carries the scaffolded URL.
  if (publishedIds.includes(used)) {
    return true;
  }
  const id = schema.body.$id;
  if (typeof id === "string") {
    // An `$id` is the schema's own statement of what flows name it by, so a
    // flow that names something else is about a different schema — even when
    // the two URLs end in the same file name. Guessing past a disagreement is
    // how a command would edit the wrong flow.
    return id === used;
  }
  // No `$id` to go on: a Project scaffolded but never applied names the
  // schema by the URL setup wrote, whose last segment is the file name.
  return used.endsWith(`/${schema.name}.json`);
}

/**
 * The platform ids a local file is known by, from `.zitadel/state.json`: the
 * id it was last synced as, and the one it replaced. `apply` records the
 * replaced id before it re-pins the flows, so a flow left behind by an
 * interrupted run still names it, and must still count as this schema's flow.
 * Absent before the first `apply`, and absent entirely on a Project that has
 * never synced — both mean "fall back to matching on the scaffolded URL".
 *
 * Only a missing file falls back. A malformed or unreadable state file is the
 * authoritative record failing to answer, and the fallback matches on a URL
 * suffix rather than an id, so it could pick a flow bound to a different
 * schema. Saying so beats editing the wrong flow quietly.
 */
async function publishedIdsOf(cwd: string, path: string): Promise<string[]> {
  try {
    // readState only parses JSON, so the shape is checked here: a valid but
    // corrupt file must not read as "never synced" and skip a pinned flow.
    const state: unknown = await readState(cwd);
    if (!isObject(state) || !isObject(state.resources)) {
      throw new Error("resources is not an object");
    }
    const entry = state.resources[path];
    if (entry === undefined) {
      return [];
    }
    if (!isObject(entry)) {
      throw new Error(`resources["${path}"] is not an object`);
    }
    const ids = [entry.id, entry.previousId].filter((id) => id !== undefined);
    if (!ids.every((id) => typeof id === "string")) {
      throw new Error(`resources["${path}"] has an id that is not a string`);
    }
    return (ids as string[]).filter((id) => id !== "");
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return [];
    }
    throw new ZitadelError(
      "E_VALIDATION",
      `Cannot read .zitadel/state.json: ${error instanceof Error ? error.message : String(error)}`,
      {
        hint:
          "The file records which platform resource each local file was synced as. " +
          "Fix or remove it and run `zitadel apply`, then run this command again.",
        details: { file: ".zitadel/state.json" },
      },
    );
  }
}
