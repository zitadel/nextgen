/**
 * Re-exports the shared JWT verification from `@zitadel/sdk-core`.
 *
 * The JWT module is runtime-agnostic: it uses `atob`, which is available on the edge, in
 * Node.js 16 and later, and on every adapter target. It is defined once in `@zitadel/sdk-core`
 * and documented there.
 */
export { JWKS_TTL_MS, base64UrlDecode, decodeJwt, verifyJwt } from "@zitadel/sdk-core/jwt";
export type {
  ZitadelJwtPayload,
  ZitadelJwtHeader,
  ZitadelDecodedJwt,
  ZitadelVerifyJwtOptions,
} from "@zitadel/sdk-core/jwt";
