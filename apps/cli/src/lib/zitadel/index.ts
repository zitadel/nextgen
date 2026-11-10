/**
 * The project's configuration under `.zitadel/`: its user schemas, login flows,
 * identity-provider connections, operation policies and branding, read, edited,
 * checked, bundled and written through one {@link ZitadelConfig}, whose
 * collections hold each kind of document and every edit and question about it.
 *
 * @remarks
 * The configuration is kept in a {@link ConfigStore}: {@link DiskStore} for a
 * project's files, {@link MemoryStore} for a test. A file its contract
 * refuses is a {@link BrokenFile}, never a document. Nothing in this module
 * prints or knows the command line. It fails only with a {@link ConfigError},
 * and depends on nothing else under `lib/`.
 */
export {
  BRANDING_DESIGN_INFO,
  Branding,
  Brandings,
  PAGE_LAYOUT_HINT,
  RETIRED_BRANDING_DESIGNS,
  type BrandingDesignInfo,
} from "@/lib/zitadel/resources/branding";
export { BrokenFile, type BrokenFileFields } from "@/lib/zitadel/resources/broken";
export {
  Change,
  DocumentChange,
  type ChangeInput,
  type Notice,
  type SaveOptions,
  type WrittenFile,
} from "@/lib/zitadel/change";
export { Collection, PinnedCollection } from "@/lib/zitadel/resources/collection";
export { ZitadelConfig, type AnyDocument, type ConfigOptions } from "@/lib/zitadel/config";
export {
  CONNECTION_SCHEMA_REF,
  Connection,
  Connections,
  type ClaimRow,
  type ConnectionCredentials,
  type ConnectionPath,
  type ConnectionSetting,
  type Credential,
  type LookupOptions,
  type SsoOptions,
  type UnusedConnection,
} from "@/lib/zitadel/resources/connections";
export type {
  DocumentFile,
  DocumentKind,
  DocumentStatus,
  Edit,
  ReadableFile,
  SkippedRegion,
} from "@/lib/zitadel/resources/document";
export {
  AmbiguousSchemaError,
  BrokenFilesError,
  BrokenFlowsError,
  ClientIdMismatchError,
  ConfigError,
  ConflictError,
  ConnectionExistsError,
  FileExistsError,
  InvalidHandleError,
  NoSignInLeftError,
  NotFoundError,
  NotOidcConnectionError,
  RefusedEditError,
  SchemaNotFoundError,
  UnusableSettingError,
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
export {
  claimName,
  environmentVariable,
  flowName,
  objectType,
  propertyName,
  propertyPath,
  schemaReference,
  stepName,
  type ClaimName,
  type EnvironmentVariable,
  type FlowName,
  type ObjectType,
  type PropertyName,
  type PropertyPath,
  type SchemaReference,
  type StepName,
} from "@/lib/zitadel/names";
export {
  PASSWORD_POLICY_OPERATION,
  PasswordPolicy,
  Policies,
  Policy,
  POLICY_FILE_SUFFIX,
  POLICY_TEST_SUFFIX,
  PolicyTest,
  SignupPolicy,
  USER_CREATE_POLICY_OPERATION,
  type PasswordMinLength,
  type PolicyCase,
  type PolicyCaseResult,
  type PolicyConfig,
  type PolicyExpectation,
  type PolicyOperation,
  type PolicySelection,
  type PolicyVerdict,
} from "@/lib/zitadel/resources/policies";
export {
  Schemas,
  TOGGLEABLE_METHODS,
  UserSchema,
  type EnabledMethods,
  type ForceOptions,
  type SchemaEdit,
  type ToggleableMethod,
} from "@/lib/zitadel/resources/schemas";
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
export type { ConfigStore, MissingReference, WriteMode } from "@/lib/zitadel/storage/types";
export { isJsonObject, isJsonValue } from "@/lib/zitadel/utils/json";
export {
  CONFIG_DIRECTORIES,
  CONFIG_KINDS,
  type BuiltBundle,
  type ConfigFile,
  type ConfigurationBundle,
  type ConfigFiles,
  type ConfigKind,
  type JsonArray,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
  type Scaffold,
  type ScaffoldedConnection,
  type ScaffoldedProvider,
  type ScaffoldOptions,
  type StoredFile,
  RELEASE_POLICY_GLOBS,
} from "@/lib/zitadel/types";
export { UnparsedFile } from "@/lib/zitadel/storage/unparsed-file";
