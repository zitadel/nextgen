/**
 * Re-exports shared JWT verification from `@zitadel/sdk-core`.
 *
 * The JWT module is runtime-agnostic (uses `atob`, available in Edge, Node.js
 * 16+, and every SvelteKit adapter target) and is defined once in sdk-core.
 */
export { JWKS_TTL_MS, base64UrlDecode, decodeJwt, verifyJwt } from "@zitadel/sdk-core/jwt";
export type { JwtPayload, JwtHeader, DecodedJwt, VerifyJwtOptions } from "@zitadel/sdk-core/jwt";
