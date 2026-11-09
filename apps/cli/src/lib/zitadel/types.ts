/**
 * The types a caller of `lib/zitadel` passes in and gets back.
 */

import type { FlowRuleId } from "@zitadel/config/validate";

import type { ZitadelConfig } from "@/lib/zitadel/config";
import type { UserSchema } from "@/lib/zitadel/schemas/schema";

/** A parsed JSON object, as a configuration file holds at its root. */
export type JsonObject = Readonly<Record<string, unknown>>;

/** The directories the configuration is made of, one per kind of file. */
export const CONFIG_KINDS = ["schemas", "flows", "connections", "policies", "branding"] as const;

/** One directory of the configuration. */
export type ConfigKind = (typeof CONFIG_KINDS)[number];

/** Where each kind of file lives, relative to the project root. */
export const CONFIG_DIRECTORIES = {
  schemas: ".zitadel/schemas",
  flows: ".zitadel/flows",
  connections: ".zitadel/idps",
  policies: ".zitadel/policies",
  branding: ".zitadel/branding",
} as const satisfies Readonly<Record<ConfigKind, string>>;

/** One configuration file: its project-relative path and its parsed body. */
export type ConfigFile = Readonly<{
  path: string;
  body: JsonObject;
}>;

/** Every file of the configuration, by kind. */
export type ConfigFiles = Readonly<Record<ConfigKind, readonly ConfigFile[]>>;

/**
 * How a file is written: `create` refuses to replace one that is already
 * there, so a scaffold never overwrites a developer's file by accident;
 * `replace` writes over it.
 */
export type WriteMode = "create" | "replace";

/** What to do with a `$file` reference whose file cannot be read. */
export type MissingReference = "throw" | "omit";

/**
 * Where the configuration is kept. The library never touches a disk itself: the
 * caller hands it a store, and a test hands it one that holds the files in
 * memory.
 */
export interface ConfigStore {
  /**
   * Every `*.json` file of one kind.
   *
   * @param kind - The kind of file to read.
   * @returns The files, in file-name order.
   */
  read(kind: ConfigKind): Promise<readonly ConfigFile[]>;

  /**
   * Write one file's body.
   *
   * @param file - The file to write.
   * @param mode - Whether an existing file may be replaced.
   */
  write(file: ConfigFile, mode: WriteMode): Promise<void>;

  /**
   * Write a file a configuration file references, such as branding's template.
   *
   * @param path - The project-relative path.
   * @param text - What it holds.
   * @param mode - Whether an existing file may be replaced.
   */
  writeText(path: string, text: string, mode: WriteMode): Promise<void>;

  /**
   * A body with every `{ "$file": "./x" }` reference replaced by the text of
   * the file it names, resolved against the directory of the file the body is
   * from.
   *
   * @param file - The file whose references to resolve.
   * @param missing - What to do with a reference that cannot be read.
   * @returns The body with its references inlined.
   */
  inlineReferences(file: ConfigFile, missing: MissingReference): JsonObject;

  /**
   * The project-relative paths a file's `$file` references point at.
   *
   * @param file - The file.
   * @returns The paths.
   */
  referencedPaths(file: ConfigFile): readonly string[];
}

/** How serious a finding is: an error stops a deploy, a warning does not. */
export type Severity = "error" | "warning";

/** What some rules need beyond the files, and are skipped without. */
export type ValidationContext = Readonly<{
  /** Where branding's `$file` references are read from. */
  store?: ConfigStore | undefined;
  /** The environment a deploy runs in, which `${VAR}` references must resolve against. */
  environment?: Readonly<Record<string, string | undefined>> | undefined;
}>;

/** Every rule this library makes. A flow is also held to the server's own flow rules. */
export const RULE_IDS = [
  "contract/schema",
  "contract/flow",
  "contract/connection",
  "contract/policy",
  "contract/branding",
  "connection/literal-secret",
  "connection/endpoints",
  "branding/legacy-template-key",
  "branding/template-file",
  "branding/template",
  "environment/missing-variable",
  "sso/duplicate-slug",
  "sso/shared-variable",
  "sso/duplicate-provider",
  "sso/connection-resolves",
  "sso/flow-enables-sso",
  "sso/provider-id",
  "sso/outcome-routing",
  "sso/collection-conflict-routing",
  "sso/empty-claim-mapping",
  "sso/collection-misses-required",
  "sso/unknown-connection-field",
  "sso/unmapped-verification-key",
  "sso/claim-needs-scope",
  "sso/verification-source-not-boolean",
  "sso/claim-name-whitespace",
  "sso/subject-claim-unstable",
  "sso/claim-type-mismatch",
  "sso/orphaned-mapping-target",
  "sso/orphaned-verification-key",
] as const;

/** One rule's id: this library's, or one of the server's flow rules. */
export type RuleId = (typeof RULE_IDS)[number] | FlowRuleId;

/** A finding: what is wrong, where, and what to change. */
export type Issue = Readonly<{
  severity: Severity;
  rule: RuleId;
  /** The project-relative path of the file it is in. */
  file: string;
  /**
   * The flow steps it is about, when it is about steps. One issue covers every
   * step with the same problem, so a mistake made on four steps is one line to
   * read and one fix to make.
   */
  steps?: readonly string[];
  /** The connection slug it is about, when it is about one. */
  slug?: string;
  message: string;
}>;

/**
 * The methods switched on and off by a flag alone. SSO is not one of them: a
 * provider needs credentials, a connection file and flow edits.
 */
export const TOGGLEABLE_METHODS = ["password", "passkey"] as const;

/** A method switched on and off by a flag alone. */
export type ToggleableMethod = (typeof TOGGLEABLE_METHODS)[number];

/** The authentication methods a user schema enables, besides SSO. */
export type EnabledMethods = Readonly<{
  password: boolean;
  passkey: boolean;
}>;

/** A region an edit left alone because it was changed by hand. */
export type SkippedRegion = Readonly<{
  /** The step that was left alone, such as `sso-conflict`. */
  step: string;
  /** Where in the file, such as `steps.sso-conflict`. */
  region: string;
  reason: "hand-edited";
}>;

/** What an edit made of a document. */
export type EditResult = Readonly<{
  body: JsonObject;
  /** False when the edit changed nothing, which makes a rerun a no-op. */
  changed: boolean;
  skipped: readonly SkippedRegion[];
}>;

/** Something a caller should tell the person about a change: left alone, kept, or still to do. */
export type Notice = Readonly<{
  severity: "warning" | "info";
  message: string;
}>;

/** An edit to one user schema, and the configuration before and after it. */
export type SchemaEdit = Readonly<{
  before: ZitadelConfig;
  after: ZitadelConfig;
  /** The schema as it was. */
  original: UserSchema;
  /** The schema as the edit leaves it. */
  edited: UserSchema;
}>;
