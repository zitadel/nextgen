/**
 * The editor meta-schemas a project carries in `.zitadel/meta/`, as this CLI
 * writes them. One writer for `setup`, `branding eject` and `doctor`, so the
 * file a project holds and the file `doctor` compares it with cannot drift.
 *
 * They are CLI-owned generated output (ADR 042's amendment): pure functions of
 * `@zitadel/config`'s `metaSchemaFiles()` and the CLI version, read only by
 * editors and agents, never by `deploy` or the server. The `zitadel …`
 * mentions in their descriptions become the runnable public command on the
 * way out ({@link normalizePublicCliJson}), so they differ between CLI
 * versions.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { META_SCHEMA_DIR, metaSchemaFiles } from "@zitadel/config/meta-schemas";

import { isErrno } from "./errors";
import { maskPublicCliVersion, normalizePublicCliJson } from "./public-cli";

/** One meta-schema file: its project-relative path, its body, and the bytes written. */
export type ProjectMetaSchema = {
  path: string;
  body: object;
  contents: string;
};

/** How a project's copy of one meta-schema compares with this CLI's. */
export type MetaSchemaState = "current" | "missing" | "outdated";

/** Every meta-schema file a project should hold, as this CLI version writes it. */
export function projectMetaSchemas(cliVersion: string): ReadonlyArray<ProjectMetaSchema> {
  return metaSchemaFiles().map((file) => {
    const body = normalizePublicCliJson(file.body, cliVersion);
    return {
      path: `${META_SCHEMA_DIR}/${file.name}`,
      body,
      contents: `${JSON.stringify(body, null, 2)}\n`,
    };
  });
}

/**
 * Compares the project's copy of `file` with this CLI's: as parsed JSON, so
 * formatting and key order do not count, and with the CLI version in its
 * command mentions masked, so a release that left the dialect alone does not
 * either. A file that does not parse is outdated. Any read error other than a
 * missing file (a directory in its place, no permission) is thrown.
 */
export async function metaSchemaState(
  cwd: string,
  file: ProjectMetaSchema,
): Promise<MetaSchemaState> {
  let text: string;
  try {
    text = await readFile(join(cwd, file.path), "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return "missing";
    }
    throw error;
  }
  let held: unknown;
  try {
    held = JSON.parse(text);
  } catch {
    return "outdated";
  }
  return isDeepStrictEqual(maskPublicCliVersion(held), maskPublicCliVersion(file.body))
    ? "current"
    : "outdated";
}
