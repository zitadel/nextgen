/**
 * Re-exports shared JWT verification from `@zitadel-nextgen/sdk-core`.
 *
 * The JWT module is runtime-agnostic (uses `atob` which is available in both
 * Edge and Node.js 16+) and is defined once in sdk-core.
 */
export {
  JWKS_TTL_MS,
  base64UrlDecode,
  decodeJwt,
  verifyJwt,
} from '@zitadel-nextgen/sdk-core/jwt';
export type {
  JwtPayload,
  JwtHeader,
  DecodedJwt,
  VerifyJwtOptions,
} from '@zitadel-nextgen/sdk-core/jwt';
