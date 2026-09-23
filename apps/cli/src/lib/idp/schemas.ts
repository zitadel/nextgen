import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { SCHEMAS_DIR } from "../user-schema";
import { ZitadelError } from "../errors";
import { isObject } from "../json";

/** A user-schema file, with what the command has to show about it. */
export type SchemaFile = {
  /** File name without `.json`, which is what `--schema` takes. */
  readonly name: string;
  /** Project-relative path, for the summary. */
  readonly path: string;
  /** Property names the schema defines, used to build the claim mapping. */
  readonly properties: string[];
  /** Authentication methods the schema enables today, for the summary. */
  readonly methods: string[];
  readonly body: Record<string, unknown>;
};

function methodsOf(body: Record<string, unknown>): string[] {
  const methods = body["x-auth-methods"];
  if (!isObject(methods)) {
    return [];
  }
  return Object.entries(methods)
    .filter(([, value]) => isObject(value) && value.enabled === true)
    .map(([name]) => name)
    .sort();
}

/**
 * Read the Project's user schemas.
 *
 * READMEs sit in the same directory, so only `.json` files count. A schema
 * that cannot be parsed stops the command: enabling a provider edits these
 * files, and editing one we could not read is how a working setup gets
 * corrupted.
 */
export async function readSchemaFiles(cwd: string): Promise<SchemaFile[]> {
  const dir = join(cwd, SCHEMAS_DIR);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const files: SchemaFile[] = [];
  for (const entry of entries.filter((e) => e.endsWith(".json")).sort()) {
    const path = `${SCHEMAS_DIR}/${entry}`;
    let body: unknown;
    try {
      body = JSON.parse(await readFile(join(dir, entry), "utf8"));
    } catch (error) {
      throw new ZitadelError("E_VALIDATION", `${path} is not valid JSON`, {
        hint: "Fix the file, then run the command again.",
        details: { file: path, parse_error: String(error) },
      });
    }
    if (!isObject(body)) {
      throw new ZitadelError("E_VALIDATION", `${path} does not contain a JSON object`, {
        details: { file: path },
      });
    }
    files.push({
      name: basename(entry, ".json"),
      path,
      properties: isObject(body.properties) ? Object.keys(body.properties) : [],
      methods: methodsOf(body),
      body,
    });
  }
  return files;
}

/**
 * Pick the schema to change.
 *
 * One schema is the common case and is chosen without asking. Several is
 * ambiguous, and picking silently would edit the wrong user type, so the name
 * has to be given — the interactive picker is the caller's, because this
 * module does not prompt.
 */
export function selectSchema(files: readonly SchemaFile[], requested?: string): SchemaFile {
  if (files.length === 0) {
    throw new ZitadelError("E_NOT_FOUND", `This Project has no user schema under ${SCHEMAS_DIR}`, {
      hint: "Run `zitadel setup` first.",
    });
  }
  if (requested !== undefined) {
    const wanted = requested.endsWith(".json") ? basename(requested, ".json") : requested;
    const match = files.find((file) => file.name === wanted);
    if (match === undefined) {
      throw new ZitadelError("E_NOT_FOUND", `This Project has no user schema named ${wanted}`, {
        hint: `Known schemas: ${files.map((f) => f.name).join(", ")}`,
        details: { requested: wanted, known: files.map((f) => f.name) },
      });
    }
    return match;
  }
  const [only, ...rest] = files;
  if (rest.length > 0 || only === undefined) {
    throw new ZitadelError("E_VALIDATION", "This Project has more than one user schema", {
      hint: `Name the one to change with --schema. Known schemas: ${files.map((f) => f.name).join(", ")}`,
      details: { known: files.map((f) => f.name) },
    });
  }
  return only;
}
