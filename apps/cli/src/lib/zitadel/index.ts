/**
 * The project's configuration under `.zitadel/`: its user schemas, login flows,
 * identity-provider connections, operation policies and branding, read, edited,
 * checked, bundled and written through one {@link ZitadelConfig}, whose
 * collections hold each kind of document and every edit and question about it.
 *
 * @remarks
 * The configuration is kept in a {@link ConfigStore}: {@link DiskStore} for a
 * project's files. A file its contract refuses is a {@link BrokenFile}, never a
 * document. Nothing in this module prints or knows the command line. It fails
 * only with a {@link ConfigError}, and depends on nothing else under `lib/`.
 */
export {
  BRANDING_DESIGN_INFO,
  Branding,
  Brandings,
  PAGE_LAYOUT_HINT,
  RETIRED_BRANDING_DESIGNS,
} from "@/lib/zitadel/resources/branding";
export { BrokenFile } from "@/lib/zitadel/resources/broken";
export { Change, DocumentChange } from "@/lib/zitadel/change";

export { ZitadelConfig, type ConfigOptions } from "@/lib/zitadel/config";
export {
  Connection,
  type ConnectionSetting,
  type Credential,
  type SsoOptions,
} from "@/lib/zitadel/resources/connections";

export {
  AmbiguousSchemaError,
  BrokenFilesError,
  BrokenFlowsError,
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
} from "@/lib/zitadel/errors";
export { Flow, Flows, type IncomingTransition } from "@/lib/zitadel/resources/flows";
export {
  claimName,
  environmentVariable,
  flowName,
  objectType,
  propertyName,
  propertyPath,
  schemaReference,
  stepName,
} from "@/lib/zitadel/names";
export { OAuthSettings } from "@/lib/zitadel/resources/oauth";
export {
  PASSWORD_POLICY_OPERATION,
  PasswordPolicy,
  Policy,
  POLICY_FILE_SUFFIX,
  POLICY_TEST_SUFFIX,
  PolicyTest,
  SignupPolicy,
  USER_CREATE_POLICY_OPERATION,
  type PasswordMinLength,
  type PolicyCase,
  type PolicyCaseResult,
  type PolicyExpectation,
  type PolicyOperation,
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
export { DiskStore } from "@/lib/zitadel/storage";
export type {
  FlowIssue,
  FlowMethodUse,
  Issue,
  RuleId,
  Severity,
  ValidationContext,
} from "@/lib/zitadel/rules/types";
export type { ConfigStore } from "@/lib/zitadel/storage/types";
export { isJsonObject, isJsonValue } from "@/lib/zitadel/utils/json";
export {
  CONFIG_DIRECTORIES,
  type ConfigFile,
  type ConfigurationBundle,
  type ConfigKind,
  type JsonObject,
  type JsonValue,
  type Scaffold,
  type ScaffoldedConnection,
  type ScaffoldedProvider,
  type ScaffoldOptions,
  type StoredFile,
  RELEASE_POLICY_GLOBS,
} from "@/lib/zitadel/types";
export { UnparsedFile } from "@/lib/zitadel/storage/unparsed-file";
