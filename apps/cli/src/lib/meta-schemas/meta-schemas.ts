import { META_SCHEMA_DIR, metaSchemaFiles } from "@zitadel/config/meta-schemas";
import { Spelling } from "@/lib/suggestion";

import { SchemaState } from "./schema-state";
import { SchemaWriter } from "./schema-writer";
import type { MetaSchemaPath, MetaSchemaState, MetaSchemaWrites, ProjectMetaSchema } from "./types";

/**
 * The editor meta-schemas a project carries in `.zitadel/meta/`, as this CLI
 * writes them, and the one way into reading and writing them. {@link
 * MetaSchemas.write} is the one writer for `setup`, `branding eject` and
 * `doctor`, so the file a project holds and the file `doctor` compares it
 * with cannot drift, and none of them writes through a symlink.
 *
 * They are CLI-owned generated output (ADR 042's amendment), pure functions of
 * `@zitadel/config`'s `metaSchemaFiles()` and the CLI version, read only by
 * editors and agents, never by `deploy` or the server. The `zitadel …`
 * mentions in their descriptions become the runnable public command on the
 * way out, so they differ between CLI versions.
 */
export class MetaSchemas {
  /** The files, in `@zitadel/config`'s order unless narrowed. */
  readonly files: readonly ProjectMetaSchema[];

  private constructor(files: readonly ProjectMetaSchema[]) {
    this.files = files;
  }

  /**
   * Every meta-schema file a project should hold, as one CLI version writes it.
   *
   * @param cliVersion - The running CLI's version, which the command mentions name.
   * @returns The files, in `@zitadel/config`'s order.
   */
  static of(cliVersion: string): MetaSchemas {
    const spelling = Spelling.at(cliVersion);
    return new MetaSchemas(
      metaSchemaFiles().map((file) => {
        const body = spelling.normalizeJson(file.body);
        const path: MetaSchemaPath = `${META_SCHEMA_DIR}/${file.name}`;
        return {
          path,
          body,
          contents: `${JSON.stringify(body, null, 2)}\n`,
          cliVersion,
        };
      }),
    );
  }

  /**
   * Meta-schemas already in hand, such as the ones a check found stale.
   *
   * @param files - The files, as {@link MetaSchemas.of} gave them.
   * @returns Them, ready to write.
   */
  static from(files: readonly ProjectMetaSchema[]): MetaSchemas {
    return new MetaSchemas(files);
  }

  /**
   * How a project's copy of one meta-schema compares with this CLI's.
   *
   * @param cwd - The project root.
   * @param file - The meta-schema as this CLI writes it.
   * @returns How the project's copy compares.
   * @throws Any read error other than a missing file (a directory in its
   *   place, no permission).
   */
  static state(cwd: string, file: ProjectMetaSchema): Promise<MetaSchemaState> {
    return SchemaState.at(cwd).of(file);
  }

  /**
   * The first segment of a project-relative path, the last one included, that
   * is a symlink.
   *
   * @param cwd - The project root.
   * @param path - The project-relative path.
   * @returns The linked segment, or `undefined` when none is a link.
   * @throws Any `lstat` error other than a missing segment.
   */
  static linkOnPath(cwd: string, path: string): Promise<string | undefined> {
    return SchemaState.at(cwd).linkOnPath(path);
  }

  /**
   * The files that satisfy a test.
   *
   * @param keep - Whether a file stays.
   * @returns The meta-schemas that stay.
   */
  only(keep: (file: ProjectMetaSchema) => boolean): MetaSchemas {
    return new MetaSchemas(this.files.filter(keep));
  }

  /**
   * Writes each file into the project that is missing or outdated, and nothing
   * else. A current file is left alone, a linked one is never written, one that
   * cannot be read is reported rather than replaced, and when the project pins
   * a `@zitadel/*` package newer than the CLI, nothing is written.
   *
   * @param cwd - The project root.
   * @param options - `dryRun` reports what would be written and writes nothing.
   * @returns What was written, what was current, and what was left alone and why.
   * @throws When a directory cannot be created or a file cannot be written.
   */
  write(cwd: string, options: { readonly dryRun: boolean }): Promise<MetaSchemaWrites> {
    return SchemaWriter.at(cwd).write(this.files, options);
  }
}
