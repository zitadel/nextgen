/**
 * Public surface for the identity-provider domain. Every caller outside this
 * module imports from here (not from individual files) so the package
 * boundary stays observable.
 *
 * **Source of truth.** The connection document's shape is
 * `idp-connection.json`, the meta-schema generated from the OpenAPI spec and
 * shipped by `@zitadel/config`; the vendor knowledge a connection is built
 * from is the catalog in `@zitadel/config/idp-catalog`. This module owns only
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
  planConnection,
  readConnectionFiles,
} from "./connections";

export { callbackUriFor } from "./callback";

export {
  ENV_EXAMPLE,
  ENV_LOCAL,
  type EnvEntry,
  isSafeForSecrets,
  mergeEnvFile,
  type SecretOutcome,
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
