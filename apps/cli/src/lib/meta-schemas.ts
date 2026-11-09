/**
 * The editor meta-schemas a project carries in `.zitadel/meta/`, as this CLI
 * writes them. {@link writeMetaSchemas} is the one writer for `setup`,
 * `branding eject` and `doctor`, so the file a project holds and the file
 * `doctor` compares it with cannot drift, and none of them writes through a
 * symlink.
 *
 * They are CLI-owned generated output (ADR 042's amendment): pure functions of
 * `@zitadel/config`'s `metaSchemaFiles()` and the CLI version, read only by
 * editors and agents, never by `deploy` or the server. The `zitadel …`
 * mentions in their descriptions become the runnable public command on the
 * way out ({@link normalizePublicCliJson}), so they differ between CLI
 * versions.
 */
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { META_SCHEMA_DIR, metaSchemaFiles } from "@zitadel/config/meta-schemas";

import { isErrno } from "./errors";
import { pathExists, readIfExists } from "./fs";
import { parseJsonOrUndefined } from "./json";
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

/**
 * One artifact {@link writeMetaSchemas} wrote, or would write in a dry run: a
 * meta-schema file, or the directory it created to hold one.
 */
export type WrittenMetaSchema = Readonly<{
  path: string;
  kind: "file" | "dir";
  action: "create" | "update";
}>;

/** What {@link writeMetaSchemas} did with each file it was given. */
export type MetaSchemaWrites = Readonly<{
  /** The files and directories written, in the order they were written. */
  written: ReadonlyArray<WrittenMetaSchema>;
  /** The files that already held this CLI's schema, left as they were. */
  unchanged: ReadonlyArray<string>;
  /** The files a symlink on their path kept from being written. */
  linked: ReadonlyArray<string>;
  /** The files that could not be read, with the error code that stopped it. */
  unreadable: ReadonlyArray<Readonly<{ path: string; reason: string }>>;
}>;

/**
 * Writes each of `files` into the project that is missing or outdated, and
 * nothing else: the only code that writes a meta-schema file.
 *
 * {@link metaSchemaState} decides each file. A current one is left alone, a
 * `linked` one is never written, since the write would land on whatever the
 * link names, and one that cannot be read is reported rather than replaced.
 * The directory a file goes in is created when it is missing.
 *
 * @param cwd - The project root.
 * @param files - The meta-schemas to write, from {@link projectMetaSchemas}.
 * @param options - `dryRun` reports what would be written and writes nothing.
 * @returns What was written, what was current, and what was left alone and why.
 * @throws When a directory cannot be created or a file cannot be written.
 */
export async function writeMetaSchemas(
  cwd: string,
  files: ReadonlyArray<ProjectMetaSchema>,
  options: Readonly<{ dryRun: boolean }>,
): Promise<MetaSchemaWrites> {
  const written: WrittenMetaSchema[] = [];
  const unchanged: string[] = [];
  const linked: string[] = [];
  const unreadable: { path: string; reason: string }[] = [];
  for (const file of files) {
    const state = await metaSchemaState(cwd, file).catch((error: unknown) => {
      unreadable.push({
        path: file.path,
        reason: error instanceof Error && "code" in error ? String(error.code) : String(error),
      });
      return undefined;
    });
    if (state === undefined) {
      continue;
    }
    if (state === "current") {
      unchanged.push(file.path);
      continue;
    }
    if (state === "linked") {
      linked.push(file.path);
      continue;
    }
    const directory = dirname(file.path);
    const isNewDirectory =
      !(await pathExists(join(cwd, directory))) &&
      !written.some((artifact) => {
        return artifact.path === directory;
      });
    if (isNewDirectory) {
      written.push({ path: directory, kind: "dir", action: "create" });
    }
    if (!options.dryRun) {
      await mkdir(join(cwd, directory), { recursive: true });
      await writeFile(join(cwd, file.path), file.contents);
    }
    written.push({ path: file.path, kind: "file", action: state === "missing" ? "create" : "update" });
  }
  return { written, unchanged, linked, unreadable };
}

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
  const text = await readIfExists(join(cwd, file.path));
  if (text === undefined) {
    return "missing";
  }
  const held = parseJsonOrUndefined(text);
  if (held === undefined) {
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
  for (const [index] of segments.entries()) {
    const segment = segments.slice(0, index + 1).join("/");
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
