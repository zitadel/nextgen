import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { NextgenMiddlewareOptions } from "./types";

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
 * The Edge runtime has no `Buffer`, so this uses `atob` after converting
 * Base64URL characters to standard Base64 and re-padding to a multiple of four.
 *
 * @param input - A Base64URL-encoded string (no padding required).
 * @returns The decoded bytes as a `Uint8Array`.
 */
export function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decodes a compact-serialized JWT into its header and payload objects
 * without verifying the signature.
 *
 * @param token - A compact JWT string in `header.payload.signature` form.
 * @returns The decoded {@link DecodedJwt}.
 */
export function decodeJwt(token: string): DecodedJwt {
  const [h, p] = token.split(".");
  const decoder = new TextDecoder();
  return {
    header: JSON.parse(decoder.decode(base64UrlDecode(h))) as Record<string, unknown>,
    payload: JSON.parse(decoder.decode(base64UrlDecode(p))) as JwtPayload,
  };
}

/**
 * Resolves the Web Crypto `AlgorithmIdentifier` for a given JWT `alg` value.
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
 * Clones the incoming request headers, injects `extra` key/value pairs,
 * and registers them with the Next.js header-tunnelling mechanism so that
 * server components can read them via `headers()`.
 *
 * @param req   - The incoming edge request.
 * @param extra - Additional headers to inject (e.g. `x-nextgen-auth-token`).
 * @returns A new `Headers` instance with the injected values registered.
 */
function tunnelHeaders(req: NextRequest, extra: Readonly<Record<string, string>>): Headers {
  const headers = new Headers(req.headers);
  const injectedNames: string[] = [];

  for (const [name, value] of Object.entries(extra)) {
    headers.set(name, value);
    headers.set(`x-middleware-request-${name}`, value);
    injectedNames.push(name);
  }

  const existing = headers.get("x-middleware-override-headers") ?? "";
  const combined = existing
    ? `${existing},${injectedNames.join(",")}`
    : injectedNames.join(",");

  headers.set("x-middleware-override-headers", combined);
  return headers;
}

/**
 * Next.js Edge middleware that handles proxying, JWT verification, and route
 * protection in a single pass.
 *
 * Place this in your `proxy.ts` file and export it as `proxy`:
 *
 * ```ts
 * import { nextgenMiddleware } from "@zitadel/sdk-next/middleware";
 * import type { NextRequest } from "next/server";
 *
 * export function proxy(req: NextRequest) {
 *   return nextgenMiddleware(req, {
 *     issuerUrl: process.env.NEXTGEN_ISSUER_URL,
 *     protectedRoutes: ["/admin", "/dashboard*"],
 *     loginPath: "/login",
 *   });
 * }
 *
 * export const config = {
 *   matcher: ["/__nextgen/:path*", "/admin", "/login"],
 * };
 * ```
 *
 * @param req     - The incoming Next.js edge request.
 * @param options - Middleware configuration options.
 * @returns A `NextResponse` or `Response` to continue, redirect, or proxy.
 */
export async function nextgenMiddleware(
  req: NextRequest,
  options: NextgenMiddlewareOptions = {},
): Promise<NextResponse | Response> {
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

  const { pathname } = new URL(req.url);

  if (matchesRoutes(pathname, ignoredRoutes)) {
    return NextResponse.next();
  }

  if (pathname.startsWith(proxyPath)) {
    return proxyRequest(req, issuerUrl, proxyPath);
  }

  return handleAuth(req, {
    issuerUrl,
    protectedRoutes,
    loginPath,
    allowedAlgorithms,
    clockSkewMs,
    audience,
    allowedTokenTypes,
    pathname,
  });
}

/**
 * Forwards a `/__nextgen/*` request to the upstream auth backend and streams
 * the response back verbatim, stripping hop-by-hop headers in both directions.
 *
 * @param req        - The incoming edge request.
 * @param issuerUrl  - Base URL of the auth backend.
 * @param proxyPath  - The path prefix being proxied (e.g. `"/__nextgen"`).
 * @returns The proxied upstream `Response`.
 */
async function proxyRequest(
  req: NextRequest,
  issuerUrl: string,
  proxyPath: string,
): Promise<Response> {
  const { pathname, search } = new URL(req.url);
  const suffix = pathname.slice(proxyPath.length);
  const target = `${issuerUrl}${suffix}${search}`;

  const upstreamHeaders = new Headers();
  for (const [key, value] of req.headers.entries()) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      upstreamHeaders.set(key, value);
    }
  }

  const hasBody = !["GET", "HEAD"].includes(req.method);

  const upstream = await fetch(target, {
    method: req.method,
    headers: upstreamHeaders,
    body: hasBody ? req.body : undefined,
    redirect: "manual",
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);

  const responseHeaders = new Headers();

  for (const [key, value] of upstream.headers.entries()) {
    if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== "set-cookie") {
      responseHeaders.set(key, value);
    }
  }

  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

/**
 * Options passed internally to {@link handleAuth} after destructuring the
 * public-facing {@link NextgenMiddlewareOptions}.
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
 * Verifies the session token and tunnels the result to server components via
 * a request header. Redirects to the login page when the token is absent or
 * invalid on a protected route.
 *
 * @param req  - The incoming edge request.
 * @param opts - Auth handler options.
 * @returns A `NextResponse` to continue or redirect.
 */
async function handleAuth(req: NextRequest, opts: AuthHandlerOptions): Promise<NextResponse> {
  const { issuerUrl, protectedRoutes, loginPath, allowedAlgorithms, clockSkewMs, audience, allowedTokenTypes, pathname } = opts;

  const authHeader = req.headers.get("authorization");
  const bearerToken =
    authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieToken = req.cookies.get("__nextgen_session")?.value ?? null;
  const token = bearerToken ?? cookieToken;

  const payload = token
    ? await verifyJwt(token, issuerUrl, allowedAlgorithms, clockSkewMs, audience, allowedTokenTypes)
    : null;

  if (payload && token) {
    const tunnelled = tunnelHeaders(req, { "x-nextgen-auth-token": token });
    return NextResponse.next({ request: { headers: tunnelled } });
  }

  const tunnelled = tunnelHeaders(req, { "x-nextgen-auth-token": "" });
  const response = NextResponse.next({ request: { headers: tunnelled } });

  for (const cookie of req.cookies.getAll()) {
    if (cookie.name.startsWith("__nextgen")) {
      response.cookies.delete(cookie.name);
    }
  }

  if (matchesRoutes(pathname, protectedRoutes)) {
    const loginUrl = new URL(loginPath, req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl, { status: 302 });
  }

  return response;
}
