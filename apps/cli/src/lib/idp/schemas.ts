import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { FLOWS_DIR } from "@/lib/flows";
import { SCHEMAS_DIR } from "@/lib/user-schema";
import { ZitadelError } from "@/lib/errors";
import { readDirIfExists } from "@/lib/fs";
import { isObject } from "@/lib/json";
import { optionArgs } from "@/lib/public-cli";

/** A user-schema file, with what the command has to show about it. */
export type SchemaFile = {
  /** File name without `.json`, which `--schema` takes. */
  readonly name: string;
  /** The `objectType`, which a flow's `user_schema` names it by and `--schema` takes too. */
  readonly objectType: string | undefined;
  /**
   * The `--schema` value that names it and no other: its file name, or
   * `<file>.json` when that name is also another schema's `objectType`.
   */
  readonly schemaFlag: string;
  /** Project-relative path, for the summary. */
  readonly path: string;
  /** Property names the schema defines, used to build the claim mapping. */
  readonly properties: string[];
  /** Authentication methods the schema enables today, for the summary. */
  readonly methods: string[];
  readonly body: Record<string, unknown>;
};

/**
 * The authentication methods a schema document enables, sorted: every entry
 * under `x-auth-methods` whose `enabled` is `true`. What the login engine can
 * actually serve is narrower, and is the caller's to decide.
 */
export function methodsOf(body: Record<string, unknown>): string[] {
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
  // Only an absent directory means the Project has none. A permission or
  // I/O failure reported as "no user schema" would send the developer
  // looking for a missing file that is sitting right there.
  const entries = await readDirIfExists(dir);
  const files: Omit<SchemaFile, "schemaFlag">[] = [];
  for (const entry of entries.filter((e) => e.endsWith(".json")).sort()) {
    const path = `${SCHEMAS_DIR}/${entry}`;
    const body: unknown = await readFile(join(dir, entry), "utf8")
      .then((text): unknown => JSON.parse(text))
      .catch((error: unknown) => {
        throw new ZitadelError("E_VALIDATION", `${path} is not valid JSON`, {
          hint: "Fix the file, then run the command again.",
          details: { file: path, parse_error: String(error) },
        });
      });
    if (!isObject(body)) {
      throw new ZitadelError("E_VALIDATION", `${path} does not contain a JSON object`, {
        details: { file: path },
      });
    }
    files.push({
      name: basename(entry, ".json"),
      objectType:
        typeof body.objectType === "string" && body.objectType !== "" ? body.objectType : undefined,
      path,
      properties: isObject(body.properties) ? Object.keys(body.properties) : [],
      methods: methodsOf(body),
      body,
    });
  }
  return files.map((file) => ({
    ...file,
    schemaFlag: files.some((other) => other !== file && other.objectType === file.name)
      ? `${file.name}.json`
      : file.name,
  }));
}

/**
 * How a schema is listed in a refusal: its file name, and its `objectType`
 * when that differs, since `--schema` takes either.
 */
function labelOf(file: SchemaFile): string {
  return file.objectType === undefined || file.objectType === file.name
    ? file.name
    : `${file.name} (${file.objectType})`;
}

/** The schemas a refusal names, for a script: each file name with its `objectType`. */
function detailsOf(files: readonly SchemaFile[]) {
  return files.map((file) => ({ name: file.name, object_type: file.objectType ?? null }));
}

/**
 * Pick the schema to change.
 *
 * One schema is the common case and is chosen without asking. Several is
 * ambiguous, and picking silently would edit the wrong user type, so the name
 * has to be given — the interactive picker is the caller's, because this
 * module does not prompt. The name is the file name or the schema's
 * `objectType`, which is what a flow's `user_schema` names it by; a name that
 * fits more than one schema is refused rather than guessed, and `<file>.json`
 * names the file alone.
 */
export function selectSchema(files: readonly SchemaFile[], requested?: string): SchemaFile {
  if (files.length === 0) {
    throw new ZitadelError("E_NOT_FOUND", `This Project has no user schema under ${SCHEMAS_DIR}`, {
      hint: "Run `zitadel setup` first.",
    });
  }
  if (requested !== undefined) {
    // `<file>.json` names the file alone, which is how an ambiguous name is
    // settled.
    const byFile = requested.endsWith(".json");
    const wanted = byFile ? basename(requested, ".json") : requested;
    const matches = files.filter(
      (file) => file.name === wanted || (!byFile && file.objectType === wanted),
    );
    const [match, ...others] = matches;
    if (match === undefined) {
      throw new ZitadelError("E_NOT_FOUND", `This Project has no user schema named ${wanted}`, {
        hint: `Known schemas: ${files.map(labelOf).join(", ")}`,
        details: {
          requested: wanted,
          known: files.map((file) => file.name),
          schemas: detailsOf(files),
        },
      });
    }
    if (others.length > 0) {
      const byFileArgs = matches.map((file) => optionArgs("--schema", file.schemaFlag).join(" "));
      throw new ZitadelError(
        "E_VALIDATION",
        `More than one user schema is named ${wanted}: ${matches.map(labelOf).join(", ")}`,
        {
          hint: `Name the one to change by its file: ${byFileArgs.join(" or ")}`,
          details: {
            requested: wanted,
            candidates: matches.map((file) => file.name),
            schemas: detailsOf(matches),
          },
        },
      );
    }
    return match;
  }
  const [only, ...rest] = files;
  if (rest.length > 0 || only === undefined) {
    throw new ZitadelError("E_VALIDATION", "This Project has more than one user schema", {
      hint: `Name the one to change with --schema. Known schemas: ${files.map(labelOf).join(", ")}`,
      details: { known: files.map((file) => file.name), schemas: detailsOf(files) },
    });
  }
  return only;
}

/** The login flow files a Project holds, with the names to report them by. */
export type FlowFile = {
  readonly name: string;
  readonly path: string;
  readonly body: Record<string, unknown>;
};

/**
 * Read the Project's flow files.
 *
 * A flow names the schema it runs against, so the caller can pick the ones
 * belonging to the schema being changed rather than editing every flow.
 */
export async function readFlowFiles(cwd: string): Promise<FlowFile[]> {
  const dir = join(cwd, FLOWS_DIR);
  // Only an absent directory means the Project has none. A permission or
  // I/O failure reported as "no user schema" would send the developer
  // looking for a missing file that is sitting right there.
  const entries = await readDirIfExists(dir);
  const files: FlowFile[] = [];
  for (const entry of entries.filter((e) => e.endsWith(".json")).sort()) {
    const path = `${FLOWS_DIR}/${entry}`;
    const body: unknown = await readFile(join(dir, entry), "utf8")
      .then((text): unknown => JSON.parse(text))
      .catch((error: unknown) => {
        throw new ZitadelError("E_VALIDATION", `${path} is not valid JSON`, {
          hint: "Fix the file, then run the command again.",
          details: { file: path, parse_error: String(error) },
        });
      });
    if (!isObject(body)) {
      throw new ZitadelError("E_VALIDATION", `${path} does not contain a JSON object`, {
        details: { file: path },
      });
    }
    files.push({ name: basename(entry, ".json"), path, body });
  }
  return files;
}

/** The authentication methods a schema document enables. */
export type AuthMethods = { password: boolean; passkey: boolean };

/**
 * Read the enabled methods straight off a schema document.
 *
 * Setup composes its schema in memory and never reads it back from disk, so
 * it needs this before a {@link SchemaFile} exists.
 */
export function authMethods(body: Record<string, unknown>): AuthMethods {
  const enabled = methodsOf(body);
  return { password: enabled.includes("password"), passkey: enabled.includes("passkey") };
}

/** Whether a schema file enables a given authentication method. */
export function enabledMethods(schema: SchemaFile): AuthMethods {
  return {
    password: schema.methods.includes("password"),
    passkey: schema.methods.includes("passkey"),
  };
}
