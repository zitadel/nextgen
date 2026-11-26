/**
 * The shared JWT verification helpers, re-exported from `@zitadel/sdk-core`.
 *
 * The module is runtime-agnostic: it uses `atob`, which is available on edge runtimes and in
 * Node.js 16 and later. It is defined once in `@zitadel/sdk-core`, and its documentation lives
 * with the definitions there.
 *
 * @module
 */
export { JWKS_TTL_MS, base64UrlDecode, decodeJwt, verifyJwt } from "@zitadel/sdk-core/jwt";
export type {
  ZitadelJwtPayload,
  ZitadelJwtHeader,
  ZitadelDecodedJwt,
  ZitadelVerifyJwtOptions,
} from "@zitadel/sdk-core/jwt";
