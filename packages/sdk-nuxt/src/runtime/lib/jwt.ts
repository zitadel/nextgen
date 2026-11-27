/**
 * Re-exports the shared JWT verification from `@zitadel/sdk-core`.
 *
 * The module is defined once in `@zitadel/sdk-core` and works on every runtime, including edge
 * runtimes, because it uses `atob` instead of Node's `Buffer`.
 */
export { JWKS_TTL_MS, base64UrlDecode, decodeJwt, verifyJwt } from "@zitadel/sdk-core/jwt";
export type { ZitadelVerifyJwtOptions } from "@zitadel/sdk-core/jwt";
