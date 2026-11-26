import { dirname, join } from "node:path";

import semver from "semver";

import {
  FsDeniedError,
  FsError,
  FsIsDirectoryError,
  FsNotDirectoryError,
  mkdir,
  pathExists,
  writeFile,
} from "@/lib/fs";
import { PmManifestInvalidError } from "@/lib/pm";
import { mapBounded } from "@/lib/map-bounded";
import { ZITADEL_SCOPE } from "@/lib/upgrade/defaults";
import { Dependencies } from "@/lib/upgrade/dependencies";

import { SchemaState } from "./schema-state";
import type {
  MetaSchemaPath,
  MetaSchemaState,
  MetaSchemaWrites,
  NewerPin,
  ProjectMetaSchema,
  UnreadableMetaSchema,
  WrittenMetaSchema,
} from "./types";

/**
 * One file as {@link SchemaWriter.write} found it.
 */
type Judged =
  | { readonly kind: "judged"; readonly file: ProjectMetaSchema; readonly state: MetaSchemaState }
  | { readonly kind: "unreadable"; readonly file: ProjectMetaSchema; readonly reason: string };

/**
 * A file {@link SchemaWriter.write} writes, and whether it creates or replaces it.
 */
type Stale = {
  readonly file: ProjectMetaSchema;
  readonly action: "create" | "update";
};

/**
 * The only code that writes a meta-schema file.
 */
export class SchemaWriter {
  /** The project root. */
  readonly cwd: string;

  private constructor(cwd: string) {
    this.cwd = cwd;
  }

  /**
   * The writer for one project.
   *
   * @param cwd - The project root.
   * @returns The writer.
   */
  static at(cwd: string): SchemaWriter {
    return new SchemaWriter(cwd);
  }

  /**
   * Writes each of `files` into the project that is missing or outdated, and
   * nothing else.
   *
   * @remarks
   * {@link SchemaState.of} decides each file. A current one is left alone, a
   * `linked` one is never written, since the write would land on whatever the
   * link names, and one that cannot be read is reported rather than replaced.
   * When the project pins a `@zitadel/*` package newer than the CLI the files
   * are for, nothing is written, so no caller can downgrade schemas a newer
   * CLI wrote.
   * The directory a file goes in is created when it is missing, and listed
   * before the first file written into it.
   *
   * @param files - The meta-schemas to write.
   * @param options - `dryRun` reports what would be written and writes nothing.
   * @returns What was written, what was current, and what was left alone and why.
   * @throws When a directory cannot be created or a file cannot be written.
   */
  async write(
    files: readonly ProjectMetaSchema[],
    options: { readonly dryRun: boolean },
  ): Promise<MetaSchemaWrites> {
    const cwd = this.cwd;
    const judged = await mapBounded(files, 1, async (file): Promise<Judged> => {
      try {
        const state = await SchemaState.at(cwd).of(file);
        return { kind: "judged", file, state };
      } catch (error) {
        return { kind: "unreadable", file, reason: this.readErrorReason(error) };
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
    const newer = await this.newerPinFor(cwd, wanted);
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
      const file: WrittenMetaSchema = {
        kind: "file",
        path: entry.file.path,
        action: entry.action,
      };
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
      unchanged: this.pathsIn(judged, "current"),
      linked: this.pathsIn(judged, "linked"),
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
  private async newerPinFor(cwd: string, stale: readonly Stale[]): Promise<NewerPin | undefined> {
    const first = stale[0];
    if (first === undefined) {
      return undefined;
    }
    const cliVersion = first.file.cliVersion;
    if (semver.valid(cliVersion) === null) {
      return undefined;
    }
    try {
      const dependencies = await Dependencies.read(cwd, ZITADEL_SCOPE);
      const pin = dependencies?.exact().find((dependency) => {
        return dependency.isAhead(cliVersion);
      });
      if (pin === undefined) {
        return undefined;
      }
      return { name: pin.name, version: pin.specifier };
    } catch (error) {
      if (error instanceof FsError) {
        return undefined;
      }
      if (error instanceof PmManifestInvalidError) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * The paths of the files found in one state.
   *
   * @param judged - Every file, as found.
   * @param state - The state.
   * @returns The paths, in the order the files were given.
   */
  private pathsIn(judged: readonly Judged[], state: MetaSchemaState): readonly MetaSchemaPath[] {
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
  private readErrorReason(error: unknown): string {
    if (error instanceof FsDeniedError) {
      return "EACCES";
    }
    if (error instanceof FsIsDirectoryError) {
      return "EISDIR";
    }
    if (error instanceof FsNotDirectoryError) {
      return "ENOTDIR";
    }
    return String(error);
  }
}
