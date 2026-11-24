import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { isErrno } from "@/lib/errno";
import { readIfExists } from "@/lib/fs";
import { parseJsonOrUndefined } from "@/lib/json";

import type { MetaSchemaState, ProjectMetaSchema } from "./types";
import { CliPackage } from "@/lib/upgrade";

/**
 * How a project's copy compares by content alone, before the symlink rule.
 */
type ContentState = Exclude<MetaSchemaState, "linked">;

/**
 * How a project's copy of a meta-schema compares with this CLI's, and where a
 * symlink keeps it from being written.
 */
export class SchemaState {
  /** The version selector of a public `npx @zitadel/cli@<selector>` mention. */
  private static readonly VERSION_MENTION = new RegExp(
    `${CliPackage.NAME.replaceAll("/", "\\/")}@[^\\s\`]+`,
    "g",
  );

  /** The project root. */
  readonly cwd: string;

  private constructor(cwd: string) {
    this.cwd = cwd;
  }

  /**
   * How a project's meta-schemas compare, read from its root.
   *
   * @param cwd - The project root.
   * @returns The project's state.
   */
  static at(cwd: string): SchemaState {
    return new SchemaState(cwd);
  }

  /**
   * Replaces the version in every public CLI mention inside a JSON document with `*`, so two
   * documents written for different CLI versions compare equal when nothing else differs.
   *
   * @param value - A JSON document, or any part of one.
   * @returns A rewritten copy; the input is never mutated.
   */
  static maskVersion<T>(value: T): T {
    if (typeof value === "string") {
      return value.replace(SchemaState.VERSION_MENTION, `${CliPackage.NAME}@*`) as T;
    }
    if (Array.isArray(value)) {
      return value.map((item) => {
        return SchemaState.maskVersion(item);
      }) as T;
    }
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          return [key, SchemaState.maskVersion(item)];
        }),
      ) as T;
    }
    return value;
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
   * and {@link SchemaState.linkOnPath} names the link.
   *
   * @param file - The meta-schema as this CLI writes it.
   * @returns How the project's copy compares.
   * @throws Any read error other than a missing file (a directory in its place,
   *   no permission).
   */
  async of(file: ProjectMetaSchema): Promise<MetaSchemaState> {
    const state = await this.content(file);
    if (state === "current") {
      return state;
    }
    const link = await this.linkOnPath(file.path);
    if (link !== undefined) {
      return "linked";
    }
    return state;
  }

  /**
   * The first segment of the project-relative `path`, the last one included,
   * that is a symlink.
   *
   * @remarks
   * Checked without following links, and up to the first segment that does not
   * exist, since nothing below it can be a link.
   *
   * @param path - The project-relative path.
   * @returns The linked segment, or `undefined` when none is a link.
   * @throws Any `lstat` error other than a missing segment.
   */
  async linkOnPath(path: string): Promise<string | undefined> {
    const segments = path.split("/");
    const prefixes = segments.map((_segment, index) => {
      return segments.slice(0, index + 1).join("/");
    });
    for (const prefix of prefixes) {
      try {
        const stats = await lstat(join(this.cwd, prefix));
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

  /**
   * {@link SchemaState.of} without the symlink rule.
   *
   * @param file - The meta-schema as this CLI writes it.
   * @returns How the project's copy compares by content.
   * @throws Any read error other than a missing file.
   */
  private async content(file: ProjectMetaSchema): Promise<ContentState> {
    const text = await readIfExists(join(this.cwd, file.path));
    if (text === undefined) {
      return "missing";
    }
    const held = parseJsonOrUndefined(text);
    if (held === undefined) {
      return "outdated";
    }
    if (isDeepStrictEqual(SchemaState.maskVersion(held), SchemaState.maskVersion(file.body))) {
      return "current";
    }
    return "outdated";
  }
}
