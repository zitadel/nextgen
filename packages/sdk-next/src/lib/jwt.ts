/**
 * Re-exports the shared JWT verification from `@zitadel/sdk-core`.
 *
 * The JWT module is runtime-agnostic: it uses `atob` and Web Crypto, which both the Next.js edge
 * runtime and Node.js provide, so the middleware and {@link server!auth | auth} verify a
 * token by the same rules. It is defined once in `@zitadel/sdk-core`. This file is internal to the
 * package and is not an entry point.
 */
export {
  JWKS_TTL_MS,
  base64UrlDecode,
  decodeJwt,
  isJwtShaped,
  verifyJwt,
} from "@zitadel/sdk-core/jwt";
export type { JwtPayload, JwtHeader, DecodedJwt, VerifyJwtOptions } from "@zitadel/sdk-core/jwt";
