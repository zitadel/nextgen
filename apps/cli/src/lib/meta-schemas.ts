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
import { lstat, readFile } from "node:fs/promises";
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

/**
 * How a project's copy of one meta-schema compares with this CLI's. `linked`
 * means it is missing or outdated, but a symlink on its path keeps it from
 * being written.
 */
export type MetaSchemaState = "current" | "missing" | "outdated" | "linked";

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
 *
 * Reading follows symlinks, so a linked file or folder that holds the current
 * schema passes. Writing must not: a missing or outdated file is overwritten,
 * and through a link at the file or at a directory on its way (`.zitadel`,
 * `.zitadel/meta`) that write would land on whatever the link names, such as
 * `.zitadel/secret` or a file outside the project. Such a file is `linked`,
 * and {@link linkOnPath} names the link.
 */
export async function metaSchemaState(
  cwd: string,
  file: ProjectMetaSchema,
): Promise<MetaSchemaState> {
  const state = await contentState(cwd, file);
  if (state !== "current" && (await linkOnPath(cwd, file.path)) !== undefined) {
    return "linked";
  }
  return state;
}

/** {@link metaSchemaState} without the symlink rule. */
async function contentState(
  cwd: string,
  file: ProjectMetaSchema,
): Promise<"current" | "missing" | "outdated"> {
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

/**
 * The first segment of the project-relative `path`, the last one included,
 * that is a symlink, or undefined. Checked without following links, and up to
 * the first segment that does not exist, since nothing below it can be a link.
 */
export async function linkOnPath(cwd: string, path: string): Promise<string | undefined> {
  const segments = path.split("/");
  for (let end = 1; end <= segments.length; end++) {
    const segment = segments.slice(0, end).join("/");
    try {
      if ((await lstat(join(cwd, segment))).isSymbolicLink()) {
        return segment;
      }
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        return undefined;
      }
      throw error;
    }
  }
  return undefined;
}
