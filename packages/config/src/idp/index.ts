/**
 * The providers `zitadel setup` and `sso enable` can scaffold a connection for.
 *
 * Adding a catalog one means adding a class, naming it in {@link IDP_PROVIDERS}
 * and listing it in the registry below, which the compiler holds to the same
 * set. That is a code change rather than a data change, which is the point: a
 * provider is not only a table of values, and the ones that differ — OAuth2
 * rather than OIDC, a second request to read an email, a claim the vendor does
 * not emit — differ in behaviour. Holding that in the provider keeps it out of
 * the callers.
 *
 * Anything else the catalog does not list is a custom connection the developer
 * describes, and {@link ProviderSelection} is how a caller says which of the two
 * it holds.
 */
import { CUSTOM_PROVIDER, CustomOidcProvider, type CustomOidcInput } from "./custom.js";
import { GoogleProvider } from "./google.js";
import type { IdpProvider } from "./provider.js";
import type { ConnectionSlug } from "./types.js";

/** Every catalog provider's id. The `--provider` flag takes one, or `custom`. */
export const IDP_PROVIDERS = Object.freeze(["google"] as const);

/** What a connection may not be called: a provider the catalog names, or the word that selects a custom one. */
export const RESERVED_SLUGS: readonly string[] = [...IDP_PROVIDERS, CUSTOM_PROVIDER];

/** The id of a provider the catalog lists. */
export type CatalogProviderId = (typeof IDP_PROVIDERS)[number];

const REGISTRY: Readonly<Record<CatalogProviderId, IdpProvider>> = Object.freeze({
  google: new GoogleProvider(),
});

/** The text names a provider goes by on a command line and in a result. */
export type ProviderName = CatalogProviderId | typeof CUSTOM_PROVIDER;

/**
 * One provider by id.
 *
 * Takes an id, not any text: the callers that hold text have to go through
 * {@link parseProviderSelection}, which says what to do with a name nothing
 * answers to.
 */
export function idpProvider(id: CatalogProviderId): IdpProvider {
  const provider = REGISTRY[id];
  if (provider === undefined || !Object.hasOwn(REGISTRY, id)) {
    throw new Error(
      `unknown identity provider ${JSON.stringify(id)} (known providers: ${IDP_PROVIDERS.join(", ")})`,
    );
  }
  return provider;
}

/**
 * Which provider a connection is for: one the catalog knows, or one the
 * developer described. A union rather than a name plus optional settings, so a
 * custom provider cannot exist without its settings and a catalog one cannot
 * carry any.
 */
export type ProviderSelection =
  | { readonly kind: "catalog"; readonly id: CatalogProviderId }
  | { readonly kind: "custom"; readonly connection: CustomOidcInput };

/**
 * The selection a name and its settings describe, or `undefined` when no
 * provider answers to the name — or when `custom` arrives without the
 * settings that make it a connection.
 */
export function parseProviderSelection(
  name: string,
  custom?: CustomOidcInput,
): ProviderSelection | undefined {
  if (name === CUSTOM_PROVIDER) {
    return custom === undefined ? undefined : { kind: "custom", connection: custom };
  }
  return (IDP_PROVIDERS as readonly string[]).includes(name)
    ? { kind: "catalog", id: name as CatalogProviderId }
    : undefined;
}

/** The provider a selection names. */
export function providerOf(selection: ProviderSelection): IdpProvider {
  return selection.kind === "catalog"
    ? idpProvider(selection.id)
    : new CustomOidcProvider(selection.connection);
}

/** The slug the selection's connection is written and referenced under. */
export function selectionSlug(selection: ProviderSelection): ConnectionSlug {
  return selection.kind === "catalog" ? idpProvider(selection.id).slug : selection.connection.slug;
}

/** The selection's name, as a command line and a result say it: `google`, or `custom`. */
export function selectionName(selection: ProviderSelection): ProviderName {
  return selection.kind === "catalog" ? selection.id : CUSTOM_PROVIDER;
}

export {
  CUSTOM_PROVIDER,
  CustomOidcProvider,
  type CustomOidcInput,
} from "./custom.js";
export { GoogleProvider } from "./google.js";
export { OidcProvider } from "./oidc-provider.js";
export {
  credentialVariable,
  credentialVariables,
  isVariableReference,
  referencedVariable,
  variableReference,
  type CallbackGuidance,
  type ConnectionEndpoints,
  type CredentialVariables,
  type IdpProvider,
  type ScaffoldOptions,
} from "./provider.js";
export {
  DEFAULT_SCOPES,
  parseClientId,
  parseClientSecret,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  parseScopes,
  validated,
  type ClientId,
  type ClientIdVariable,
  type ClientSecret,
  type ClientSecretVariable,
  type ConnectionSlug,
  type Credentials,
  type DisplayName,
  type Issuer,
  type Parsed,
  type Scopes,
} from "./types.js";
