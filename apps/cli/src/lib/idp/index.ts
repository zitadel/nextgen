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
 * command line needs around it as plain data and logic: choosing the provider
 * from flags, the claim mapping, the callback URI, and publishing a credential
 * through a publisher the caller passes in.
 *
 * **Dependency rule.** Generic: it asks, prints, warns and suggests nothing, so
 * nothing here imports `lib/ui`, `lib/log`, `lib/warnings`, `lib/suggestion`,
 * `lib/terminal-text` or `lib/oclif`, nor `cli/commands/`, `sync/` or
 * `lib/backend`: nothing here calls the server. It depends sideways only on
 * `lib/errors`, `lib/zitadel` (the configuration a provider is added to) and
 * `@zitadel/config`. The steps that use it draw its results.
 */

export { callbackUriFor } from "./callback";
export {
  applyRequest,
  asksForClaims,
  CLAIM_TYPES,
  type ClaimEntry,
  type ClaimRequest,
  type ClaimType,
  choiceOf,
  claimFlagTexts,
  claimRequestFromFlags,
  claimsOrRefuse,
  fits,
  type MappingState,
  mapClaim,
  NO_CLAIM_REQUEST,
  parseClaimEntry,
  parseClaimName,
  parseNewAttributeName,
  parseScopeList,
  parseVerifiedEntry,
  seedMapping,
  standardClaimType,
  type VerifiedEntry,
} from "./claims";
export {
  type CredentialNames,
  type CredentialVariable,
  type GivenCredentials,
  type PublishedCredentials,
  type PublishState,
  publishClientId,
  type SecretOutcome,
  type SecretPublisher,
  storeClientSecret,
  unpublished,
} from "./credentials";
export {
  type CustomFlagValues,
  customExample,
  customFlagValues,
  ENABLE_FLAG_KEYS,
  ENABLE_FLAG_NAMES,
  givenCustomFlags,
  loopbackIssuerWarning,
  SETUP_FLAG_KEYS,
  SETUP_FLAG_NAMES,
  selectionFromFlags,
} from "./custom";
