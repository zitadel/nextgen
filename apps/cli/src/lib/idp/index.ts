/**
 * Public surface for the identity-provider domain. Every caller outside this
 * module imports from here (not from individual files) so the package
 * boundary stays observable.
 *
 * **Source of truth.** The connection document's shape is
 * `idp-connection.json`, the meta-schema generated from the OpenAPI spec and
 * shipped by `@zitadel/config`; the vendor knowledge a connection is built
 * from is the provider classes in `@zitadel/config/idp`. Adding a provider to
 * the configuration, and finding the connection one already has, is
 * `lib/zitadel`'s (`config.connections.enable`). This module owns only what the
 * command line needs around it: the flags that describe a custom provider, the
 * callback URI, asking for endpoints, and publishing credentials to the project.
 *
 * **Dependency rule.** No upward imports (`commands/`, `sync/`). It depends
 * sideways only on shared utilities under `apps/cli/src/lib/` — today
 * `lib/errors` (`ZitadelError`), `lib/input` (`Asker`), `lib/warnings`
 * (`reportWarning`) and `lib/suggestion` (the suggested follow-up commands).
 */
export {
  customFlagText,
  selectionFromFlags,
  type CustomFlagNames,
  checkGivenCustomFlags,
  customExample,
  customFlagValues,
  ENABLE_FLAG_KEYS,
  flagText,
  SETUP_FLAG_KEYS,
  loopbackIssuerWarning,
  type LoopbackReach,
  ENABLE_FLAG_NAMES,
  givenCustomFlags,
  SETUP_FLAG_NAMES,
  ssoEnableArgs,
  type CustomFlagValues,
} from "./custom";

export { callbackUriFor } from "./callback";

export { askConnectionEndpoints } from "./endpoints";

export {
  publishClientId,
  type PublishState,
  reportClientIdOutcome,
  reportSecretOutcome,
  republishArgs,
  republishCommand,
  republishCommands,
  type SecretOutcome,
  type SecretPublisher,
  storeClientSecret,
} from "./credentials";
