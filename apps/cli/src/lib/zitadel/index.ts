/**
 * The project's configuration under `.zitadel/`: its user schemas, login flows,
 * identity-provider connections, operation policies and branding, read, edited,
 * checked, bundled and written through one {@link ZitadelConfig}, whose
 * collections hold each kind of document and every edit and question about it.
 *
 * @remarks
 * The configuration is kept in a {@link ConfigStore}: {@link DiskStore} for a
 * project's files, {@link MemoryStore} for a test. Nothing in this module
 * prints or knows the command line. It fails only with a {@link ConfigError},
 * and depends on nothing else under `lib/`.
 */
export { Branding, Brandings } from "@/lib/zitadel/resources/branding";
export { toBundle, type BuiltBundle, type ConfigurationBundle } from "@/lib/zitadel/bundle";
export { Change, DocumentChange, type Notice, type SaveOptions } from "@/lib/zitadel/change";
export { Collection } from "@/lib/zitadel/resources/collection";
export { ZitadelConfig, type AnyDocument, type ConfigOptions } from "@/lib/zitadel/config";
export {
  CONNECTION_SCHEMA_REF,
  Connection,
  Connections,
  type ClaimRow,
  type ConnectionSetting,
  type CredentialNames,
  type LookupOptions,
  type SsoOptions,
  type StoredSettings,
  type UnusedConnection,
  type VariableUse,
} from "@/lib/zitadel/resources/connections";
export type { DocumentStatus, Edit, SkippedRegion } from "@/lib/zitadel/resources/document";
export {
  AmbiguousSchemaError,
  BrokenFilesError,
  BrokenFlowsError,
  ConfigError,
  ConflictError,
  ConnectionExistsError,
  FileExistsError,
  NoSignInLeftError,
  NotFoundError,
  RefusedEditError,
  SchemaNotFoundError,
  type BrokenFlows,
  type ConfigErrorOptions,
  type FileProblem,
  type NoSignInLeft,
} from "@/lib/zitadel/errors";
export {
  Flow,
  Flows,
  PASSWORD_FIELD,
  type IncomingTransition,
  type MethodUse,
  type Offer,
  type SignUpGap,
  type Step,
  type Transition,
} from "@/lib/zitadel/resources/flows";
export type { ClaimName, PropertyName, StepName } from "@/lib/zitadel/names";
export {
  PASSWORD_POLICY_OPERATION,
  PasswordPolicy,
  Policies,
  Policy,
  POLICY_FILE_SUFFIX,
  POLICY_TEST_SUFFIX,
  PolicyTest,
  type PasswordMinLength,
  type PolicyBody,
  type PolicyCase,
  type PolicyConfig,
  type PolicyExpectation,
  type PolicyOperation,
  type PolicySelection,
  type PolicyTestBody,
} from "@/lib/zitadel/resources/policies";
export { type ForceOptions, Schemas, UserSchema } from "@/lib/zitadel/resources/schemas";
export { DiskStore, MemoryStore } from "@/lib/zitadel/storage";
export {
  RULE_IDS,
  type FlowCheck,
  type FlowIssue,
  type FlowMethodUse,
  type Issue,
  type RuleId,
  type Severity,
  type ValidationContext,
} from "@/lib/zitadel/rules/types";
export {
  TOGGLEABLE_METHODS,
  type EnabledMethods,
  type SchemaEdit,
  type ToggleableMethod,
} from "@/lib/zitadel/resources/schemas/types";
export type { ConfigStore, MissingReference, WriteMode } from "@/lib/zitadel/storage/types";
export {
  CONFIG_DIRECTORIES,
  CONFIG_KINDS,
  type ConfigFile,
  type ConfigFiles,
  type ConfigKind,
  type JsonObject,
  type Scaffold,
  type ScaffoldedConnection,
  type ScaffoldedProvider,
  type ScaffoldOptions,
  RELEASE_POLICY_GLOBS,
} from "@/lib/zitadel/types";
