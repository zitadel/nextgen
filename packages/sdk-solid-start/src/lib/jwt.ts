/**
 * The JWT decoding and verification helpers, re-exported from `@zitadel/sdk-core`.
 *
 * The helpers use only Web APIs such as `atob`, so they run unchanged in Node.js, on edge
 * runtimes and in the browser. They are defined once in core and shared by every server SDK.
 *
 * @module
 */
export { JWKS_TTL_MS, base64UrlDecode, decodeJwt, verifyJwt } from "@zitadel/sdk-core/jwt";
export type { JwtPayload, JwtHeader, DecodedJwt, VerifyJwtOptions } from "@zitadel/sdk-core/jwt";
