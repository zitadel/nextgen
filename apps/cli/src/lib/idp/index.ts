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
 * command line needs around it: choosing the provider from flags and answers
 * ({@link ProviderChoice}), the callback URI, asking for endpoints, asking for
 * the credentials ({@link CredentialPrompt}), and publishing them to the
 * project through a publisher the caller passes in ({@link CredentialDelivery}).
 *
 * **Dependency rule.** No upward imports (`commands/`, `sync/`), none of
 * `lib/oclif`, and none of `lib/backend`: nothing here calls the server. It
 * depends sideways only on `lib/zitadel` (the configuration a provider is
 * added to) and shared utilities under `apps/cli/src/lib/` — today
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
  shellWord,
  SETUP_FLAG_KEYS,
  loopbackIssuerWarning,
  type LoopbackReach,
  ENABLE_FLAG_NAMES,
  givenCustomFlags,
  SETUP_FLAG_NAMES,
  ssoEnableArgs,
  type CustomFlagValues,
} from "./custom";

export { askClaims } from "./claim-wizard";

export {
  applyRequest,
  asksForClaims,
  claimFlagText,
  attributesOf,
  type ClaimFlagNames,
  type ClaimFlagValues,
  claimRequestFromFlags,
  claimsOrRefuse,
  ENABLE_CLAIM_FLAGS,
  SETUP_CLAIM_FLAGS,
  CLAIM_TYPES,
  claimNotes,
  type ClaimEntry,
  type ClaimRequest,
  type ClaimType,
  fieldLabelFor,
  type MappingState,
  NO_CLAIM_REQUEST,
  parseClaimEntry,
  parseScopeList,
  parseVerifiedEntry,
  type SchemaAttribute,
  seedMapping,
  type VerifiedEntry,
} from "./claims";

export { callbackUriFor } from "./callback";

export { askConnectionEndpoints } from "./endpoints";

export {
  ProviderChoice,
  type ProviderFlags,
  type ProviderRun,
  type ProviderTarget,
  type StoredSettings,
} from "./provider";

export { CredentialPrompt, type PromptRun } from "./prompt";

export { CredentialDelivery, type DeliveryRun } from "./delivery";

export {
  type CredentialNames,
  type GivenCredentials,
  type PublishedCredentials,
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
