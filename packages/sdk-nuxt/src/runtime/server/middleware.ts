import type { H3Event } from "h3";
import {
  defineEventHandler,
  getCookie,
  parseCookies,
  deleteCookie,
  sendRedirect,
  getRequestURL,
  getRequestHeader,
  readRawBody,
} from "h3";
import type { AuthResult, NextgenModuleOptions } from "../types";

declare module "h3" {
  interface H3EventContext {
    nextgenAuth: AuthResult;
  }
}

/**
 * Headers that must never be forwarded to an upstream service.
 * These are connection-level headers that are meaningful only between
 * two directly connected peers and become invalid when proxied.
 */
const HOP_BY_HOP: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * In-memory JWKS key cache, keyed by `kid`.
 * Each entry holds the imported `CryptoKey` and the timestamp it was fetched.
 */
const jwksCache = new Map<string, { readonly key: CryptoKey; readonly fetchedAt: number }>();

/** How long a cached JWKS key is considered fresh before re-fetching. */
const JWKS_TTL_MS = 5 * 60 * 1000;

/**
 * The subset of JWT claims this middleware reads after verification.
 * Additional claims are preserved under the index signature.
 */
interface JwtPayload {
  readonly sub?: string;
  readonly exp?: number;
  readonly nbf?: number;
  readonly iat?: number;
  readonly email?: string;
  readonly name?: string;
  readonly [key: string]: unknown;
}

/**
 * The decoded parts of a compact-serialized JWT.
 */
interface DecodedJwt {
  readonly header: Record<string, unknown>;
  readonly payload: JwtPayload;
}

/**
 * Decodes a Base64URL-encoded string into a `Uint8Array`.
 *
 * Uses Node.js's built-in `Buffer` which natively handles the Base64URL
 * alphabet, removing the need for manual character substitution or padding.
 *
 * @param input - A Base64URL-encoded string (no padding required).
 * @returns The decoded bytes as a `Uint8Array`.
 */
function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(input, "base64url"));
}

/**
 * Decodes a compact-serialized JWT into its header and payload objects
 * without verifying the signature.
 *
 * @param token - A compact JWT string in `header.payload.signature` form.
 * @returns The decoded {@link DecodedJwt}.
 */
function decodeJwt(token: string): DecodedJwt {
  const [h, p] = token.split(".");
  const decoder = new TextDecoder();
  return {
    header: JSON.parse(decoder.decode(base64UrlDecode(h))) as Record<string, unknown>,
    payload: JSON.parse(decoder.decode(base64UrlDecode(p))) as JwtPayload,
  };
}

/**
 * Resolves the Web Crypto `AlgorithmIdentifier` for a given JWT `alg` value,
 * used when importing a key from the JWKS.
 *
 * @param alg - The JWT algorithm string (e.g. `"RS256"`, `"ES256"`).
 * @returns The corresponding Web Crypto algorithm descriptor.
 */
function resolveAlgorithm(alg: string): RsaHashedImportParams | EcKeyImportParams {
  if (alg === "ES256") {
    return { name: "ECDSA", namedCurve: "P-256" };
  }
  return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
}

/**
 * Resolves the Web Crypto `AlgorithmIdentifier` used for `crypto.subtle.verify`
 * for a given JWT `alg` value.
 *
 * @param alg - The JWT algorithm string (e.g. `"RS256"`, `"ES256"`).
 * @returns The algorithm descriptor accepted by `crypto.subtle.verify`.
 */
function resolveVerifyAlgorithm(alg: string): EcdsaParams | Algorithm {
  if (alg === "ES256") {
    return { name: "ECDSA", hash: "SHA-256" };
  }
  return { name: "RSASSA-PKCS1-v1_5" };
}

/**
 * Fetches the JWKS from `jwksUri`, imports the key that matches `kid`,
 * and caches it for {@link JWKS_TTL_MS} milliseconds.
 *
 * If `kid` is absent the first key in the JWKS is used. Returns `null` when
 * no matching key is found or the fetch fails.
 *
 * @param jwksUri - The full URL of the JWKS endpoint.
 * @param kid     - The `kid` claim from the JWT header, or `undefined`.
 * @returns The imported `CryptoKey`, or `null` if unavailable.
 */
async function fetchAndCacheJwks(
  jwksUri: string,
  kid: string | undefined,
): Promise<CryptoKey | null> {
  if (kid) {
    const cached = jwksCache.get(kid);
    if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
      return cached.key;
    }
  }

  const res = await fetch(jwksUri);
  const json = (await res.json()) as { keys: (JsonWebKey & { kid?: string; alg?: string })[] };

  const jwk = kid ? json.keys.find((k) => k.kid === kid) : json.keys[0];

  if (!jwk) {
    return null;
  }

  const alg = (jwk.alg as string | undefined) ?? "RS256";
  const cryptoKey = await crypto.subtle.importKey("jwk", jwk, resolveAlgorithm(alg), false, [
    "verify",
  ]);

  const cacheKey = kid ?? "__default__";
  jwksCache.set(cacheKey, { key: cryptoKey, fetchedAt: Date.now() });

  return cryptoKey;
}

/**
 * Verifies a JWT against the JWKS published at `{issuerUrl}/oauth/v2/keys`.
 *
 * Verification order:
 * 1. Decode header and payload (no trust yet).
 * 2. Reject if `alg` is not in `allowedAlgorithms` (when configured).
 * 3. Reject if `typ` header is not in `allowedTokenTypes` (when non-empty).
 * 4. Fetch and cache the matching public key from JWKS.
 * 5. Verify the cryptographic signature.
 * 6. Validate `iss` against `issuerUrl` (when present in token).
 * 7. Validate `aud` against `audience` (when `audience` option is set).
 * 8. Validate `exp`, `nbf`, and `iat` with clock-skew tolerance.
 *
 * Returns `null` on any failure rather than throwing.
 *
 * @param token             - The raw compact-serialized JWT.
 * @param issuerUrl         - Base URL of the auth backend.
 * @param allowedAlgorithms - Optional allowlist of accepted `alg` values.
 * @param clockSkewMs       - Tolerance in ms for time-based claim checks.
 * @param audience          - Expected `aud` claim value(s). Skipped when `undefined`.
 * @param allowedTokenTypes - Accepted `typ` header values (case-insensitive). Pass `[]` to skip.
 * @returns The verified {@link JwtPayload}, or `null` if verification fails.
 */
async function verifyJwt(
  token: string,
  issuerUrl: string,
  allowedAlgorithms: readonly string[] | undefined,
  clockSkewMs: number,
  audience: string | string[] | undefined,
  allowedTokenTypes: string[],
): Promise<JwtPayload | null> {
  try {
    const { header, payload } = decodeJwt(token);

    const alg = (header.alg as string | undefined) ?? "RS256";

    if (allowedAlgorithms && allowedAlgorithms.length > 0 && !allowedAlgorithms.includes(alg)) {
      return null;
    }

    if (allowedTokenTypes.length > 0) {
      const typ = (header.typ as string | undefined) ?? "";
      if (!allowedTokenTypes.some((t) => t.toLowerCase() === typ.toLowerCase())) {
        return null;
      }
    }

    const kid = header.kid as string | undefined;
    const jwksUri = `${issuerUrl}/oauth/v2/keys`;
    const cryptoKey = await fetchAndCacheJwks(jwksUri, kid);

    if (!cryptoKey) {
      return null;
    }

    const [h, p, sig] = token.split(".");
    const data = new TextEncoder().encode(`${h}.${p}`);
    const valid = await crypto.subtle.verify(
      resolveVerifyAlgorithm(alg),
      cryptoKey,
      base64UrlDecode(sig),
      data,
    );

    if (!valid) {
      return null;
    }

    if (payload.iss !== undefined && payload.iss !== issuerUrl) {
      return null;
    }

    if (audience !== undefined) {
      const audList = Array.isArray(payload.aud)
        ? (payload.aud as string[])
        : [payload.aud as string | undefined];
      const expectedList = Array.isArray(audience) ? audience : [audience];
      if (!expectedList.some((a) => audList.includes(a))) {
        return null;
      }
    }

    const now = Date.now();

    if (payload.exp !== undefined && payload.exp * 1000 < now - clockSkewMs) {
      return null;
    }

    if (payload.nbf !== undefined && payload.nbf * 1000 > now + clockSkewMs) {
      return null;
    }

    if (payload.iat !== undefined && payload.iat * 1000 > now + clockSkewMs) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Returns `true` when `pathname` matches at least one entry in `routes`.
 *
 * An entry ending with `*` matches any path that starts with the prefix
 * before the `*`. All other entries require an exact match.
 *
 * @param pathname - The URL pathname to test.
 * @param routes   - The list of route patterns to match against.
 * @returns `true` if at least one pattern matches.
 */
function matchesRoutes(pathname: string, routes: readonly string[]): boolean {
  if (routes.length === 0) {
    return false;
  }

  return routes.some((pattern) => {
    if (pattern.endsWith("*")) {
      return pathname.startsWith(pattern.slice(0, -1));
    }
    return pathname === pattern;
  });
}

/**
 * Builds the set of upstream request headers by copying all incoming headers
 * and dropping anything in {@link HOP_BY_HOP}.
 *
 * Node.js header values may be a string or an array of strings; arrays are
 * joined with `", "` to produce a single header value.
 *
 * @param event - The current H3 event.
 * @returns A `Headers` instance safe to forward to the upstream service.
 */
function buildUpstreamHeaders(event: H3Event): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.node.req.headers)) {
    if (!value || HOP_BY_HOP.has(key.toLowerCase())) {
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

/**
 * Creates an H3 event handler that handles proxying, JWT verification, and
 * route protection in a single pass.
 *
 * Register it as a Nitro server middleware in `server/middleware/auth.ts`:
 *
 * ```ts
 * import { createNextgenMiddleware } from "@nextgen/sdk-nuxt/server";
 *
 * export default createNextgenMiddleware({
 *   issuerUrl: process.env.NEXTGEN_ISSUER_URL,
 *   protectedRoutes: ["/admin", "/dashboard*"],
 *   loginPath: "/login",
 * });
 * ```
 *
 * @param options - Middleware configuration options.
 * @returns An H3 event handler suitable for use as a global server middleware.
 */
export function createNextgenMiddleware(options: NextgenModuleOptions = {}) {
  const {
    issuerUrl = process.env.NEXTGEN_ISSUER_URL ?? "http://localhost:4000",
    proxyPath = "/__nextgen",
    protectedRoutes = [],
    ignoredRoutes = [],
    loginPath = "/login",
    allowedAlgorithms,
    clockSkewMs = 5000,
    audience,
    allowedTokenTypes = ["JWT", "at+JWT"],
  } = options;

  return defineEventHandler(async (event: H3Event) => {
    const url = getRequestURL(event);
    const { pathname } = url;

    if (matchesRoutes(pathname, ignoredRoutes)) {
      return;
    }

    if (pathname.startsWith(proxyPath)) {
      return proxyRequest(event, issuerUrl, proxyPath, url);
    }

    await handleAuth(event, {
      issuerUrl,
      protectedRoutes,
      loginPath,
      allowedAlgorithms,
      clockSkewMs,
      audience,
      allowedTokenTypes,
      pathname,
    });
  });
}

/**
 * Forwards a `/__nextgen/*` request to the upstream auth backend and streams
 * the response back verbatim, including `Set-Cookie` headers.
 * Hop-by-hop headers are stripped in both directions.
 *
 * @param event      - The current H3 event.
 * @param issuerUrl  - Base URL of the auth backend.
 * @param proxyPath  - The path prefix being proxied (e.g. `"/__nextgen"`).
 * @param url        - The parsed request URL.
 * @returns The upstream response body stream.
 */
async function proxyRequest(
  event: H3Event,
  issuerUrl: string,
  proxyPath: string,
  url: URL,
): Promise<ReadableStream<Uint8Array> | null> {
  const suffix = url.pathname.slice(proxyPath.length);
  const target = `${issuerUrl}${suffix}${url.search}`;

  const method = event.node.req.method ?? "GET";
  const hasBody = !["GET", "HEAD"].includes(method);
  const rawBody = hasBody ? await readRawBody(event, false) : undefined;
  const body = rawBody != null ? new Uint8Array(rawBody) : undefined;

  const upstream = await fetch(target, {
    method,
    headers: buildUpstreamHeaders(event),
    body,
    redirect: "manual",
  });

  event.node.res.statusCode = upstream.status;

  for (const [key, value] of upstream.headers.entries()) {
    if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== "set-cookie") {
      event.node.res.setHeader(key, value);
    }
  }

  const setCookieHeaders = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookieHeaders) {
    event.node.res.appendHeader("set-cookie", cookie);
  }

  return upstream.body;
}

/**
 * Options passed internally to {@link handleAuth} after destructuring the
 * public-facing {@link NextgenModuleOptions}.
 */
interface AuthHandlerOptions {
  readonly issuerUrl: string;
  readonly protectedRoutes: readonly string[];
  readonly loginPath: string;
  readonly allowedAlgorithms: readonly string[] | undefined;
  readonly clockSkewMs: number;
  readonly audience: string | string[] | undefined;
  readonly allowedTokenTypes: string[];
  readonly pathname: string;
}

/**
 * Verifies the session token and writes the auth result to `event.context`.
 * Deletes a stale cookie when the token is present but invalid.
 * Redirects to the login page on protected routes with no valid session.
 *
 * @param event - The current H3 event.
 * @param opts  - Auth handler options.
 */
async function handleAuth(event: H3Event, opts: AuthHandlerOptions): Promise<void> {
  const { issuerUrl, protectedRoutes, loginPath, allowedAlgorithms, clockSkewMs, audience, allowedTokenTypes, pathname } = opts;

  const authHeader = getRequestHeader(event, "authorization");
  const bearerToken =
    authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieToken = getCookie(event, "__nextgen_session") ?? null;
  const token = bearerToken ?? cookieToken;

  const payload = token
    ? await verifyJwt(token, issuerUrl, allowedAlgorithms, clockSkewMs, audience, allowedTokenTypes)
    : null;

  if (payload && token) {
    event.context.nextgenAuth = {
      isAuthenticated: true,
      session: {
        userId: payload.sub ?? "",
        email: payload.email ?? null,
        name: payload.name ?? null,
        token,
      },
    };
    return;
  }

  event.context.nextgenAuth = { isAuthenticated: false, session: null };

  for (const name of Object.keys(parseCookies(event))) {
    if (name.startsWith("__nextgen")) {
      deleteCookie(event, name);
    }
  }

  if (matchesRoutes(pathname, protectedRoutes)) {
    await sendRedirect(event, `${loginPath}?next=${encodeURIComponent(pathname)}`, 302);
  }
}

/**
 * Reads the auth state from a Nitro/H3 event context.
 *
 * Call this inside any server route or API handler after the middleware has run:
 *
 * ```ts
 * import { getAuth } from "@nextgen/sdk-nuxt/server";
 *
 * export default defineEventHandler((event) => {
 *   const auth = getAuth(event);
 *   if (!auth.isAuthenticated) throw createError({ statusCode: 401 });
 *   return { userId: auth.session.userId };
 * });
 * ```
 *
 * @param event - The current H3 event.
 * @returns The current {@link AuthResult}.
 */
export function getAuth(event: H3Event): AuthResult {
  return event.context.nextgenAuth ?? { isAuthenticated: false, session: null };
}
