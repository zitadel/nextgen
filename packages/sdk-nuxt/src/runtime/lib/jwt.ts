/**
 * Re-exports shared JWT verification from `@zitadel/sdk-core`.
 *
 * The JWT module is runtime-agnostic (uses `atob` which is available in both
 * Edge and Node.js 16+) and is defined once in sdk-core.
 */
export {
  JWKS_TTL_MS,
  base64UrlDecode,
  decodeJwt,
  isJwtShaped,
  verifyJwt,
} from "@zitadel/sdk-core/jwt";
export type { JwtPayload, JwtHeader, DecodedJwt, VerifyJwtOptions } from "@zitadel/sdk-core/jwt";
