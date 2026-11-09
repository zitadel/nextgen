/**
 * The types every part of `lib/zitadel` shares: a file, its body, and where
 * each kind of file lives.
 */

import type { SkippedRegion } from "@/lib/zitadel/resources/flows/types";

/**
 * A parsed JSON object, as a configuration file holds at its root.
 */
export type JsonObject = Readonly<Record<string, unknown>>;

/**
 * The directories the configuration is made of, one per kind of file.
 */
export const CONFIG_KINDS = ["schemas", "flows", "connections", "policies", "branding"] as const;

/**
 * One directory of the configuration.
 */
export type ConfigKind = (typeof CONFIG_KINDS)[number];

/**
 * Where each kind of file lives, relative to the project root.
 */
export const CONFIG_DIRECTORIES = {
  schemas: ".zitadel/schemas",
  flows: ".zitadel/flows",
  connections: ".zitadel/idps",
  policies: ".zitadel/policies",
  branding: ".zitadel/branding",
} as const satisfies Readonly<Record<ConfigKind, string>>;

/**
 * One configuration file: its project-relative path and its parsed body.
 */
export type ConfigFile = Readonly<{
  /**
   * The file's project-relative path.
   */
  path: string;
  /**
   * The file's parsed body.
   */
  body: JsonObject;
}>;

/**
 * Every file of the configuration, by kind.
 */
export type ConfigFiles = Readonly<Record<ConfigKind, readonly ConfigFile[]>>;

/**
 * What an edit made of a document.
 */
export type EditResult = Readonly<{
  /**
   * The document's body after the edit.
   */
  body: JsonObject;
  /**
   * False when the edit changed nothing, which makes a rerun a no-op.
   */
  changed: boolean;
  /**
   * The regions the edit left alone because they were changed by hand.
   */
  skipped: readonly SkippedRegion[];
}>;
