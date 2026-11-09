/**
 * The project's configuration under `.zitadel/`: its user schemas, login flows,
 * identity-provider connections, operation policies and branding, read, edited,
 * checked, bundled and written through one {@link ZitadelConfig}.
 *
 * The configuration is kept in a {@link ConfigStore}: {@link DiskStore} for a
 * project's files, {@link MemoryStore} for a test. Nothing in this module
 * prints or knows the command line. It fails only with a {@link ConfigError},
 * and depends on nothing else under `lib/`.
 */
export { Branding } from "@/lib/zitadel/branding";
export { toBundle, type BuiltBundle, type ConfigurationBundle } from "@/lib/zitadel/bundle";
export { Change, type SaveOptions } from "@/lib/zitadel/change";
export {
  ZitadelConfig,
  type AnyDocument,
  type ConfigOptions,
  type Offer,
  type SignUpGap,
} from "@/lib/zitadel/config";
export {
  CONNECTION_SCHEMA_REF,
  Connection,
  type ClaimRow,
  type ConnectionSetting,
  type CredentialNames,
  type LookupOptions,
  type SsoOptions,
  type UnknownField,
  type VariableUse,
} from "@/lib/zitadel/connections";
export type { DocumentStatus } from "@/lib/zitadel/document";
export {
  BrokenFilesError,
  BrokenFlowsError,
  ConfigError,
  ConflictError,
  FileExistsError,
  NoSignInLeftError,
  NotFoundError,
  RefusedEditError,
  type BrokenFlows,
  type ConfigErrorOptions,
  type FileProblem,
  type NoSignInLeft,
} from "@/lib/zitadel/errors";
export {
  Flow,
  PASSWORD_FIELD,
  type FlowCheck,
  type FlowEdit,
  type FlowIssue,
  type FlowMethodUse,
  type IncomingTransition,
  type MethodUse,
  type Step,
  type Transition,
} from "@/lib/zitadel/flows";
export type { ClaimName, PropertyName, StepName } from "@/lib/zitadel/names";
export { Policy, POLICY_TEST_SUFFIX, PolicyTest } from "@/lib/zitadel/policies";
export { type ForceOptions, UserSchema } from "@/lib/zitadel/schemas";
export { DiskStore, MemoryStore } from "@/lib/zitadel/storage";
export {
  CONFIG_DIRECTORIES,
  CONFIG_KINDS,
  RULE_IDS,
  type ConfigFile,
  type ConfigFiles,
  type ConfigKind,
  type ConfigStore,
  type EnabledMethods,
  type Issue,
  type JsonObject,
  type MissingReference,
  type Notice,
  type RuleId,
  type Severity,
  type SkippedRegion,
  TOGGLEABLE_METHODS,
  type ToggleableMethod,
  type ValidationContext,
  type WriteMode,
} from "@/lib/zitadel/types";
