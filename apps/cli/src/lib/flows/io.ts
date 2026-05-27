import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "../errors";
import { stableStringify } from "../json";
import { type FlowDefinition, flowDefinitionSchema } from "./schema";

/**
 * Relative directory (from the project root) where local flow files
 * live. Matches the layout `zitadel setup` scaffolds.
 */
export const FLOWS_DIR = ".zitadel/flows";

/**
 * Options for {@link readLocalFlows}. `requireDir: true` throws a
 * `E_VALIDATION` `ZitadelError` when the flows directory is missing,
 * which is the behavior the `locale` command expects (so users get a
 * pointer back to `zitadel setup`). The default (`false`) treats a
 * missing directory as an empty result set, matching `apply`'s
 * tolerance for projects that haven't scaffolded yet.
 */
export type ReadLocalFlowsOptions = {
  readonly requireDir?: boolean;
};

/**
 * Read every `.json` file under `<cwd>/.zitadel/flows` and return the
 * raw parsed JSON. Files are read in lexical order so the result is
 * deterministic for downstream hashing and diffs. Throws an
 * `E_VALIDATION` `ZitadelError` for syntactically invalid JSON;
 * schema validation is **not** performed here so unknown keys (e.g.
 * forward-compatible flow properties, `${VAR}` placeholders inside
 * custom fields) survive intact. Callers that need schema-validated
 * `FlowDefinition` values should pass the result to {@link validateFlows}.
 *
 * Returns an empty array when the directory is missing, unless
 * `requireDir` is true (the `locale` command uses that mode so users
 * get a pointer back to `zitadel setup`).
 *
 * @param cwd - The project root.
 * @param opts - See {@link ReadLocalFlowsOptions}.
 */
export async function readLocalFlows(
  cwd: string,
  opts: ReadLocalFlowsOptions = {},
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const dir = join(cwd, FLOWS_DIR);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      if (opts.requireDir) {
        throw new ZitadelError(
          "E_VALIDATION",
          "No .zitadel/flows directory — run `zitadel setup` first.",
          { nextCommands: ["zitadel setup"] },
        );
      }
      return [];
    }
    throw error;
  }
  const result: Record<string, unknown>[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const abs = join(dir, entry);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(abs, "utf8"));
    } catch {
      throw new ZitadelError("E_VALIDATION", `Flow definition ${entry} is not valid JSON`);
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new ZitadelError("E_VALIDATION", `Flow definition ${entry} must be a JSON object`);
    }
    result.push(raw as Record<string, unknown>);
  }
  return result;
}

/**
 * Validate an arbitrary list of objects against
 * {@link flowDefinitionSchema}. On any parse failure throws an
 * `E_VALIDATION` `ZitadelError` carrying every issue found across all
 * inputs (so callers see the full picture in one error). Returns the
 * parsed flows when validation succeeds.
 *
 * @param flows - The raw values to validate. Unknown-typed so callers
 *   can pass freshly-parsed JSON without first asserting a shape.
 */
export function validateFlows(flows: ReadonlyArray<unknown>): ReadonlyArray<FlowDefinition> {
  const issues: Array<{ index: number; issues: unknown }> = [];
  const parsed: FlowDefinition[] = [];
  for (let i = 0; i < flows.length; i += 1) {
    const result = flowDefinitionSchema.safeParse(flows[i]);
    if (!result.success) {
      issues.push({ index: i, issues: result.error.issues });
      continue;
    }
    parsed.push(result.data);
  }
  if (issues.length > 0) {
    throw new ZitadelError("E_VALIDATION", "One or more flow definitions are invalid", {
      details: { issues },
    });
  }
  return parsed;
}

/**
 * Write a single flow definition to `<cwd>/.zitadel/flows/<name>.json`,
 * creating the directory tree if needed. The body is serialized via
 * `stableStringify` so the file content is canonical (sorted keys,
 * trailing newline) and diff-friendly. Does not validate the input —
 * callers building from {@link buildFlowAndLocale} already produce a
 * valid shape; bytes-in / bytes-out is the contract here.
 *
 * @param cwd - The project root.
 * @param name - The slug used as the filename stem. Caller is responsible
 *   for ensuring this matches `flow.name` if a particular convention is
 *   intended.
 * @param flow - The flow_definition body to serialize.
 */
export async function writeLocalFlow(
  cwd: string,
  name: string,
  flow: Readonly<FlowDefinition>,
): Promise<void> {
  const dir = join(cwd, FLOWS_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.json`), `${stableStringify(flow)}\n`, "utf8");
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === code
  );
}
