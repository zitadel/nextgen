/**
 * Public surface for the identity-provider domain. Every caller outside this
 * module imports from here (not from individual files) so the package
 * boundary stays observable.
 *
 * **Source of truth.** The connection document's shape is
 * `idp-connection.json`, the meta-schema generated from the OpenAPI spec and
 * shipped by `@zitadel/config`; the vendor knowledge a connection is built
 * from is the provider classes in `@zitadel/config/idp`. This module owns only
 * the CLI-specific concerns: locating a Project's connection files, deciding
 * whether a provider already has one, and keeping the client secret out of
 * anything committable.
 *
 * **Dependency rule.** No upward imports (`commands/`, `sync/`). It depends
 * sideways only on shared utilities under `apps/cli/src/lib/` — today
 * `lib/errors` (`ZitadelError`) and `lib/json` (`isObject`).
 */
export {
  CONNECTION_SCHEMA_REF,
  IDPS_DIR,
  type ConnectionFile,
  type ConnectionPlan,
  credentialVariablesOf,
  type StoredVariables,
  planConnection,
  refuseResolvedSecret,
  readConnectionFiles,
} from "./connections";

export {
  applySsoToFlow,
  applySsoToSchema,
  removeSsoFromFlow,
  removeSsoFromSchema,
  ssoEditRefusal,
  ssoProvidersRefusal,
  type SsoEditTarget,
  type SsoResult,
  type SsoSkipped,
} from "./documents";

export { callbackUriFor } from "./callback";

export { askConnectionEndpoints } from "./endpoints";

export {
  publishClientId,
  type PublishState,
  reportClientIdOutcome,
  reportSecretOutcome,
  republishCommand,
  republishCommands,
  type SecretOutcome,
  type SecretPublisher,
  storeClientSecret,
} from "./credentials";

export {
  authMethods,
  enabledMethods,
  type FlowFile,
  readFlowFiles,
  readSchemaFiles,
  type SchemaFile,
  selectSchema,
} from "./schemas";
