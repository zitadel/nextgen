/**
 * The types every part of `lib/zitadel` shares: a file, its body, and where
 * each kind of file lives.
 */

import { POLICY_FILE_SUFFIX, POLICY_TEST_SUFFIX } from "@/lib/zitadel/resources/policies/types";

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
 * The policy files a release carries, as project-relative globs whose `*`
 * stops at a `/`, for git to diff on a deploy.
 *
 * @remarks
 * The files the bundle reads: the `*.json` files at the top of the policies
 * directory, never its `README.md` or a subdirectory, and never the test
 * files beside the policies, which `zitadel policies test` runs.
 */
export const RELEASE_POLICY_GLOBS = {
  /**
   * The files a release carries, test files included until {@link excluded}
   * takes them out.
   */
  included: `${CONFIG_DIRECTORIES.policies}/*${POLICY_FILE_SUFFIX}`,
  /**
   * The test files, which no release carries.
   */
  excluded: `${CONFIG_DIRECTORIES.policies}/*${POLICY_TEST_SUFFIX}`,
} as const;

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
