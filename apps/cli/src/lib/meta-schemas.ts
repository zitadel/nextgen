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
import semver from "semver";

import { Dependencies } from "@/lib/upgrade/dependencies";
import { ZITADEL_SCOPE } from "@/cli/constants";

import { isErrno } from "./errors";
import { pathExists, readIfExists } from "./fs";
import { parseJsonOrUndefined } from "./json";
import { mapBounded } from "./map-bounded";
import { maskPublicCliVersion, normalizePublicCliJson } from "./public-cli";

/**
 * The project-relative path of one meta-schema file.
 */
export type MetaSchemaPath = `${typeof META_SCHEMA_DIR}/${string}`;

/**
 * One meta-schema file: its project-relative path, its body, and the bytes written.
 */
export type ProjectMetaSchema = {
  readonly path: MetaSchemaPath;

  /**
   * The parsed schema, as `@zitadel/config` types it.
   */
  readonly body: object;
  readonly contents: string;

  /**
   * The CLI version whose command mentions the file carries.
   */
  readonly cliVersion: string;
};

/**
 * A `@zitadel/*` package a project pins to a version newer than this CLI.
 */
export type NewerPin = {
  readonly name: string;
  readonly version: string;
};

/**
 * Every way a project's copy of one meta-schema can compare with this CLI's.
 *
 * @remarks
 * `linked` means it is missing or outdated, but a symlink on its path keeps it
 * from being written.
 */
export const META_SCHEMA_STATES = ["current", "missing", "outdated", "linked"] as const;

/**
 * How a project's copy of one meta-schema compares with this CLI's.
 */
export type MetaSchemaState = (typeof META_SCHEMA_STATES)[number];

/**
 * How a project's copy compares by content alone, before the symlink rule.
 */
type ContentState = Exclude<MetaSchemaState, "linked">;

/**
 * One artifact {@link writeMetaSchemas} wrote, or would write in a dry run: a
 * meta-schema file, or the directory it created to hold one.
 */
export type WrittenMetaSchema =
  | {
      readonly kind: "dir";
      readonly path: string;
      readonly action: "create";
    }
  | {
      readonly kind: "file";
      readonly path: MetaSchemaPath;
      readonly action: "create" | "update";
    };

/**
 * A file that could not be read, with the error code that stopped it.
 */
export type UnreadableMetaSchema = {
  readonly path: MetaSchemaPath;
  readonly reason: string;
};

/**
 * What {@link writeMetaSchemas} did with each file it was given.
 */
export type MetaSchemaWrites = {
  /**
   * The files and directories written, in the order they were written.
   */
  readonly written: readonly WrittenMetaSchema[];

  /**
   * The files that already held this CLI's schema, left as they were.
   */
  readonly unchanged: readonly MetaSchemaPath[];

  /**
   * The files a symlink on their path kept from being written.
   */
  readonly linked: readonly MetaSchemaPath[];

  /**
   * The files that could not be read.
   */
  readonly unreadable: readonly UnreadableMetaSchema[];

  /**
   * The pin that kept this CLI from writing its own, older, schemas, when
   * one did: nothing was written, so a newer CLI's copy is never downgraded.
   */
  readonly newerPin: NewerPin | undefined;
};

/**
 * One file as {@link writeMetaSchemas} found it.
 */
type Judged =
  | { readonly kind: "judged"; readonly file: ProjectMetaSchema; readonly state: MetaSchemaState }
  | { readonly kind: "unreadable"; readonly file: ProjectMetaSchema; readonly reason: string };

/**
 * A file {@link writeMetaSchemas} writes, and whether it creates or replaces it.
 */
type Stale = {
  readonly file: ProjectMetaSchema;
  readonly action: "create" | "update";
};

/**
 * Writes each of `files` into the project that is missing or outdated, and
 * nothing else: the only code that writes a meta-schema file.
 *
 * @remarks
 * {@link metaSchemaState} decides each file. A current one is left alone, a
 * `linked` one is never written, since the write would land on whatever the
 * link names, and one that cannot be read is reported rather than replaced.
 * When the project pins a `@zitadel/*` package newer than the CLI the files
 * are for, nothing is written, so no caller can downgrade schemas a newer
 * CLI wrote.
 * The directory a file goes in is created when it is missing, and listed
 * before the first file written into it.
 *
 * @param cwd - The project root.
 * @param files - The meta-schemas to write, from {@link projectMetaSchemas}.
 * @param options - `dryRun` reports what would be written and writes nothing.
 * @returns What was written, what was current, and what was left alone and why.
 * @throws When a directory cannot be created or a file cannot be written.
 */
export async function writeMetaSchemas(
  cwd: string,
  files: readonly ProjectMetaSchema[],
  options: { readonly dryRun: boolean },
): Promise<MetaSchemaWrites> {
  const judged = await mapBounded(files, 1, async (file): Promise<Judged> => {
    try {
      const state = await metaSchemaState(cwd, file);
      return { kind: "judged", file, state };
    } catch (error) {
      return { kind: "unreadable", file, reason: readErrorReason(error) };
    }
  });
  const wanted = judged.flatMap((entry): readonly Stale[] => {
    if (entry.kind !== "judged") {
      return [];
    }
    if (entry.state === "missing") {
      return [{ file: entry.file, action: "create" }];
    }
    if (entry.state === "outdated") {
      return [{ file: entry.file, action: "update" }];
    }
    return [];
  });
  const newer = await newerPinFor(cwd, wanted);
  const stale = newer === undefined ? wanted : [];
  const directories = [
    ...new Set(
      stale.map((entry) => {
        return dirname(entry.file.path);
      }),
    ),
  ];
  const existing = await mapBounded(directories, 1, async (directory) => {
    return pathExists(join(cwd, directory));
  });
  const created = new Set(
    directories.filter((_directory, index) => {
      return existing[index] !== true;
    }),
  );
  const written = stale.flatMap((entry, index): readonly WrittenMetaSchema[] => {
    const directory = dirname(entry.file.path);
    const firstInDirectory = !stale.slice(0, index).some((earlier) => {
      return dirname(earlier.file.path) === directory;
    });
    const file: WrittenMetaSchema = { kind: "file", path: entry.file.path, action: entry.action };
    if (firstInDirectory && created.has(directory)) {
      return [{ kind: "dir", path: directory, action: "create" }, file];
    }
    return [file];
  });
  if (!options.dryRun) {
    await mapBounded(stale, 1, async (entry) => {
      await mkdir(join(cwd, dirname(entry.file.path)), { recursive: true });
      await writeFile(join(cwd, entry.file.path), entry.file.contents);
    });
  }
  return {
    written,
    unchanged: pathsIn(judged, "current"),
    linked: pathsIn(judged, "linked"),
    unreadable: judged.flatMap((entry): readonly UnreadableMetaSchema[] => {
      if (entry.kind !== "unreadable") {
        return [];
      }
      return [{ path: entry.file.path, reason: entry.reason }];
    }),
    newerPin: newer,
  };
}

/**
 * The first exact `@zitadel/*` pin newer than the CLI the files to write are
 * for, when both are releases.
 *
 * @param cwd - The project root.
 * @param stale - The files to write.
 * @returns The pin, or `undefined` when there is none or nothing is to be written.
 */
async function newerPinFor(cwd: string, stale: readonly Stale[]): Promise<NewerPin | undefined> {
  const first = stale[0];
  if (first === undefined) {
    return undefined;
  }
  const cliVersion = first.file.cliVersion;
  if (semver.valid(cliVersion) === null) {
    return undefined;
  }
  const dependencies = await Dependencies.read(cwd, ZITADEL_SCOPE).catch(() => {
    return undefined;
  });
  const pin = dependencies?.exact().find((dependency) => {
    return dependency.isAhead(cliVersion);
  });
  if (pin === undefined) {
    return undefined;
  }
  return { name: pin.name, version: pin.specifier };
}

/**
 * The paths of the files found in one state.
 *
 * @param judged - Every file, as found.
 * @param state - The state.
 * @returns The paths, in the order the files were given.
 */
function pathsIn(judged: readonly Judged[], state: MetaSchemaState): readonly MetaSchemaPath[] {
  return judged.flatMap((entry) => {
    if (entry.kind !== "judged" || entry.state !== state) {
      return [];
    }
    return [entry.file.path];
  });
}

/**
 * Why a file could not be read: the error code a filesystem error carries, or
 * the error itself.
 *
 * @param error - What reading the file threw.
 * @returns The reason.
 */
function readErrorReason(error: unknown): string {
  if (error instanceof Error && "code" in error) {
    return String(error.code);
  }
  return String(error);
}

/**
 * Every meta-schema file a project should hold, as this CLI version writes it.
 *
 * @param cliVersion - The running CLI's version, which the command mentions name.
 * @returns The files, in `@zitadel/config`'s order.
 */
export function projectMetaSchemas(cliVersion: string): readonly ProjectMetaSchema[] {
  return metaSchemaFiles().map((file) => {
    const body = normalizePublicCliJson(file.body, cliVersion);
    const path: MetaSchemaPath = `${META_SCHEMA_DIR}/${file.name}`;
    return {
      path,
      body,
      contents: `${JSON.stringify(body, null, 2)}\n`,
      cliVersion,
    };
  });
}

/**
 * Compares the project's copy of `file` with this CLI's.
 *
 * @remarks
 * As parsed JSON, so formatting and key order do not count, and with the CLI
 * version in its command mentions masked, so a release that left the dialect
 * alone does not either. A file that does not parse is outdated.
 *
 * Reading follows symlinks, so a linked file or folder that holds the current
 * schema passes. Writing must not: a missing or outdated file is overwritten,
 * and through a link at the file or at a directory on its way (`.zitadel`,
 * `.zitadel/meta`) that write would land on whatever the link names, such as
 * `.zitadel/secret` or a file outside the project. Such a file is `linked`,
 * and {@link linkOnPath} names the link.
 *
 * @param cwd - The project root.
 * @param file - The meta-schema as this CLI writes it.
 * @returns How the project's copy compares.
 * @throws Any read error other than a missing file (a directory in its place,
 *   no permission).
 */
export async function metaSchemaState(
  cwd: string,
  file: ProjectMetaSchema,
): Promise<MetaSchemaState> {
  const state = await contentState(cwd, file);
  if (state === "current") {
    return state;
  }
  const link = await linkOnPath(cwd, file.path);
  if (link !== undefined) {
    return "linked";
  }
  return state;
}

/**
 * {@link metaSchemaState} without the symlink rule.
 *
 * @param cwd - The project root.
 * @param file - The meta-schema as this CLI writes it.
 * @returns How the project's copy compares by content.
 * @throws Any read error other than a missing file.
 */
async function contentState(cwd: string, file: ProjectMetaSchema): Promise<ContentState> {
  const text = await readIfExists(join(cwd, file.path));
  if (text === undefined) {
    return "missing";
  }
  const held = parseJsonOrUndefined(text);
  if (held === undefined) {
    return "outdated";
  }
  if (isDeepStrictEqual(maskPublicCliVersion(held), maskPublicCliVersion(file.body))) {
    return "current";
  }
  return "outdated";
}

/**
 * The first segment of the project-relative `path`, the last one included,
 * that is a symlink.
 *
 * @remarks
 * Checked without following links, and up to the first segment that does not
 * exist, since nothing below it can be a link.
 *
 * @param cwd - The project root.
 * @param path - The project-relative path.
 * @returns The linked segment, or `undefined` when none is a link.
 * @throws Any `lstat` error other than a missing segment.
 */
export async function linkOnPath(cwd: string, path: string): Promise<string | undefined> {
  const segments = path.split("/");
  const prefixes = segments.map((_segment, index) => {
    return segments.slice(0, index + 1).join("/");
  });
  for (const prefix of prefixes) {
    try {
      const stats = await lstat(join(cwd, prefix));
      if (stats.isSymbolicLink()) {
        return prefix;
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
