/**
 * Public API for `@zitadel/api-mock`'s authentication module.
 *
 * Exports the single {@link AuthnStore} class and its associated types.
 * Internal implementation files (`authn-store.ts`) should be imported through
 * this barrel rather than directly.
 */
export { AuthnStore } from "./authn-store.js";
export type { AuthenticatorTransport, PasskeyProof, StoredCredential } from "./authn-store.js";
