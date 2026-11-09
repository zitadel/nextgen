import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";

import type { JsonObject } from "@/lib/zitadel";
import { toJsonObject } from "@/lib/zitadel/utils/json";
import { DEFAULT_SCHEMA, schemaIdOf, writeProject } from "@tests/helpers/auth-method";
import { aLoginFlow, authMethods, aUserSchema, type DocumentsByName } from "@tests/helpers/config";

/**
 * Projects on disk for the unit tests that run a command against local files:
 * the `auth-method` commands and what they read. The specs' counterpart is
 * `ScaffoldedApp` in `project.ts`, which runs `setup` instead.
 */

/**
 * What a Project holds besides its `zitadel.json`.
 */
export type ProjectFiles = Readonly<{
  /**
   * The user schemas, by file name without `.json`.
   */
  schemas?: DocumentsByName;
  /**
   * The flows, by file name without `.json`.
   */
  flows?: DocumentsByName;
  /**
   * Whether the Project is linked the way `zitadel setup` leaves it: the server
   * and development issuer in `.env.local` and a `.zitadel/secret`. Only a
   * command that publishes to the project reads them.
   */
  linked?: boolean;
}>;

/**
 * The files `zitadel setup` writes when it links a Project to a project on the
 * server, by project-relative path.
 */
const LINK_FILES: Readonly<Record<string, string>> = {
  ".env.local": "ZITADEL_URL=https://api.zitadel.cloud\nZITADEL_ISSUER=http://localhost:3000\n",
  ".zitadel/secret": `${JSON.stringify({
    project_id: "proj_01TEST",
    project_secret: "s",
    preview_secret: "s",
    primary_origins: [],
    preview_origins: [],
    created_at: new Date().toISOString(),
  })}\n`,
};

/**
 * Documents keyed by their file names, from documents keyed by those names
 * without `.json`.
 *
 * @param documents - The documents, by file name without `.json`.
 * @returns The same documents, by file name.
 */
function byFileName(documents: DocumentsByName): DocumentsByName {
  return Object.fromEntries(
    Object.entries(documents).map(([name, body]) => {
      return [`${name}.json`, body];
    }),
  );
}

/**
 * Writes a Project into a directory: its `zitadel.json`, these schemas and
 * flows, and, when it is linked, what `zitadel setup` links it with.
 *
 * @param dir - The directory to write the Project into, such as the `dir` fixture.
 * @param files - The schemas and flows it holds, and whether it is linked.
 * @returns The Project's directory, which is `dir`.
 */
export async function makeProject(dir: string, files: ProjectFiles = {}): Promise<string> {
  const { schemas = {}, flows = {}, linked = false } = files;
  const documents = { schemas: byFileName(schemas), flows: byFileName(flows) };
  if (linked) {
    await writeProject(dir, documents, LINK_FILES);
  } else {
    await writeProject(dir, documents);
  }
  return dir;
}

/**
 * The scaffolded schema, cut to what `auth-method sso enable` reads: an email
 * identifier, signing in with a password or a passkey.
 */
export const defaultSchema: JsonObject = aUserSchema({
  "x-auth-methods": authMethods("password", "passkey"),
});

/**
 * The login flow `zitadel setup` scaffolds for a schema, named after it and
 * naming the schema by the URL setup writes.
 *
 * @param schemaName - The schema's file name, without `.json`.
 * @returns The flow document.
 */
export function loginFlow(schemaName: string): JsonObject {
  return aLoginFlow({ name: `${schemaName}-login`, userSchema: schemaIdOf(schemaName) });
}

/**
 * Writes a Project as `zitadel setup` leaves it, minus what `auth-method sso
 * enable` ignores: linked, with each schema's login flow beside it and the
 * README that ships with the schemas. Every schema gets a flow because the
 * provider is offered by a flow, so a project without one is not a project the
 * command can configure.
 *
 * @param dir - The directory to write the Project into, such as the `dir` fixture.
 * @param schemas - The user schemas, by file name without `.json`; the
 *   {@link defaultSchema} alone by default.
 * @returns The Project's directory, which is `dir`.
 */
export async function setUpProject(
  dir: string,
  schemas: DocumentsByName = { [DEFAULT_SCHEMA]: defaultSchema },
): Promise<string> {
  const flows = Object.fromEntries(
    Object.keys(schemas).map((name) => {
      return [`${name}-login`, loginFlow(name)];
    }),
  );
  await makeProject(dir, { schemas, flows, linked: true });
  await writeFile(join(dir, ".zitadel/schemas/README.md"), "# schemas\n");
  return dir;
}

/**
 * Writes one JSON file into a Project, for a test whose input is that file.
 *
 * @param cwd - The Project's directory.
 * @param path - The file's project-relative path; its directory must exist.
 * @param body - What the file holds.
 * @returns Once the file is written.
 */
export async function writeJson(cwd: string, path: string, body: unknown): Promise<void> {
  await writeFile(join(cwd, path), `${JSON.stringify(body)}\n`);
}

/**
 * Reads one JSON object back out of a Project.
 *
 * @param cwd - The Project's directory.
 * @param path - The file's project-relative path.
 * @returns The object the file holds.
 * @throws {@link ConfigError} When the file holds JSON that is not an object.
 */
export async function readJson(cwd: string, path: string): Promise<JsonObject> {
  const parsed: unknown = JSON.parse(await readFile(join(cwd, path), "utf8"));
  return toJsonObject(parsed, path);
}

/**
 * Runs a command with a stand-in stdin, the way `variables` does: a scripted
 * run reads the secret from the stream, so leaving the real one in place would
 * block on a stream that never ends.
 *
 * @param piped - What was piped in; `undefined` stands for a terminal, where
 *   nothing was piped.
 * @param run - The command to run while the stand-in is in place.
 * @returns What `run` resolves to, once the real stdin is back.
 */
export async function withStdin<T>(piped: string | undefined, run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, "stdin");
  const stand = stdinFor(piped);
  Object.defineProperty(process, "stdin", { value: stand, configurable: true });
  try {
    return await run();
  } finally {
    if (original) {
      Object.defineProperty(process, "stdin", original);
    }
  }
}

/**
 * The stand-in for stdin that {@link withStdin} puts in place.
 *
 * @param piped - What was piped in, or `undefined` for a terminal.
 * @returns A stream of what was piped, or a terminal.
 */
function stdinFor(piped: string | undefined): Readable | { isTTY: true } {
  if (piped === undefined) {
    return { isTTY: true };
  }
  return Readable.from([piped]);
}
