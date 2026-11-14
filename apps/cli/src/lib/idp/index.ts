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
 * **Dependency rule.** No upward imports (`cli/commands/`, `sync/`), none of
 * `lib/oclif`, and none of `lib/backend`: nothing here calls the server. It
 * depends sideways only on `lib/zitadel` (the configuration a provider is
 * added to) and shared utilities under `apps/cli/src/lib/` — today
 * `lib/errors` (`ZitadelError`), `lib/ui` (`Questions`), `lib/warnings`
 * (`reportWarning`) and `lib/suggestion` (the suggested follow-up commands).
 */

export { callbackUriFor } from "./callback";
export {
  type AddedClaim,
  ClaimQuestions,
  type ClaimQuestionsRun,
  claimTable,
} from "./claim-questions";
export {
  applyRequest,
  asksForClaims,
  attributesOf,
  CLAIM_TYPES,
  type ClaimEntry,
  type ClaimFlagTexts,
  type ClaimFlagValues,
  type ClaimRequest,
  type ClaimType,
  choiceOf,
  claimFlagTexts,
  claimNotes,
  claimRequestFromFlags,
  claimsOrRefuse,
  fieldLabelFor,
  type MappingState,
  mapClaim,
  NO_CLAIM_REQUEST,
  parseClaimEntry,
  parseClaimName,
  parseNewAttributeName,
  parseScopeList,
  parseUnusedClaim,
  parseVerifiedEntry,
  type SchemaAttribute,
  seedMapping,
  standardClaimScope,
  standardClaimType,
  unmapped,
  type VerifiedEntry,
  verifyAttribute,
} from "./claims";
export {
  type CredentialNames,
  type GivenCredentials,
  type PublishedCredentials,
  type PublishState,
  publishClientId,
  reportClientIdOutcome,
  reportSecretOutcome,
  republishCommand,
  republishCommands,
  type SecretOutcome,
  type SecretPublisher,
  storeClientSecret,
  type Unpublished,
  unpublished,
} from "./credentials";
export {
  type CustomFlagNames,
  type CustomFlagValues,
  checkGivenCustomFlags,
  customExample,
  customFlagValues,
  ENABLE_FLAG_KEYS,
  ENABLE_FLAG_NAMES,
  givenCustomFlags,
  type LoopbackReach,
  loopbackIssuerWarning,
  SETUP_FLAG_KEYS,
  SETUP_FLAG_NAMES,
  selectionFromFlags,
  ssoEnableFlags,
} from "./custom";
export { CredentialDelivery, type DeliveryRun } from "./delivery";
export { askConnectionEndpoints } from "./endpoints";
export { CredentialPrompt, type PromptRun } from "./prompt";
export {
  ProviderChoice,
  type ProviderFlags,
  type ProviderRun,
  type ProviderTarget,
  type StoredSettings,
} from "./provider";
