/**
 * Re-exports the shared JWT verification helpers from `@zitadel/sdk-core`.
 *
 * The JWT module is runtime-agnostic. It uses `atob`, which is available on the edge, in Node.js
 * 16 and later, and in every SvelteKit adapter target. It is defined once in `@zitadel/sdk-core`,
 * so its documentation lives there.
 */
export { JWKS_TTL_MS, base64UrlDecode, decodeJwt, verifyJwt } from "@zitadel/sdk-core/jwt";
export type { JwtPayload, JwtHeader, DecodedJwt, VerifyJwtOptions } from "@zitadel/sdk-core/jwt";
