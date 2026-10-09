/**
 * The providers `zitadel setup` and `auth-method sso enable` can scaffold a
 * connection for.
 *
 * Adding one means adding a class and listing it here. That is a code change
 * rather than a data change, which is the point: a provider is not only a table
 * of values, and the ones that differ — OAuth2 rather than OIDC, a second
 * request to read an email, a claim the vendor does not emit — differ in
 * behaviour. Holding that in the provider keeps it out of the callers.
 */
import { GoogleProvider } from "./google.js";
import type { IdpProvider } from "./provider.js";

const PROVIDERS: readonly IdpProvider[] = Object.freeze([new GoogleProvider()]);

const BY_SLUG: ReadonlyMap<string, IdpProvider> = new Map(
  PROVIDERS.map((provider) => [provider.slug, provider]),
);

/** Every provider's slug, in listing order. The `--provider` flag takes one. */
export const IDP_PROVIDERS: readonly string[] = Object.freeze(
  PROVIDERS.map((provider) => provider.slug),
);

/**
 * One provider by slug.
 *
 * Throws rather than returning `undefined`: every caller has already had the
 * slug validated against {@link IDP_PROVIDERS}, so a miss here is a bug in this
 * package and not something a caller can act on.
 */
export function idpProvider(slug: string): IdpProvider {
  const provider = BY_SLUG.get(slug);
  if (provider === undefined) {
    throw new Error(
      `unknown identity provider ${JSON.stringify(slug)} (known providers: ${IDP_PROVIDERS.join(", ")})`,
    );
  }
  return provider;
}

export { ISSUER_REQUIREMENT, isSupportedIssuer } from "./issuer.js";

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
