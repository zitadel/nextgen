import type { META_SCHEMA_DIR } from "@zitadel/config/meta-schemas";

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
 * How a project's copy of one meta-schema compares with this CLI's.
 *
 * @remarks
 * `linked` means it is missing or outdated, but a symlink on its path keeps it
 * from being written.
 */
export type MetaSchemaState = "current" | "missing" | "outdated" | "linked";

/**
 * One artifact {@link MetaSchemas.write} wrote, or would write in a dry run: a
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
 * What {@link MetaSchemas.write} did with each file it was given.
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
