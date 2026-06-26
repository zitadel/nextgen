import type { Handle, RequestEvent } from "@sveltejs/kit";
import type { AuthResult, NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import {
  HOP_BY_HOP,
  INTERNAL_HEADERS,
  filterResponseHeaders,
  matchesRoutes,
} from "@zitadel/sdk-core/middleware";

import { verifyJwt, base64UrlDecode } from "./lib/jwt";

declare global {
  // SvelteKit reads `App.Locals` to type `event.locals`. Declaring the
  // interface here merges `nextgenAuth` into the consumer's own `App.Locals`
  // (defined in their `src/app.d.ts`) so `getAuth(event)` and load functions
  // see the typed auth result without any manual wiring.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace App {
    interface Locals {
      nextgenAuth?: AuthResult;
    }
  }
}

/**
 * Builds the set of upstream request headers by copying all incoming headers,
 * dropping hop-by-hop and SDK-internal headers, and setting `X-Forwarded-*`
 * headers so the upstream auth server can see the real client origin.
 *
 * All non-hop-by-hop headers from the incoming request are forwarded as-is,
 * including any `X-Forwarded-For` chain already set by an upstream CDN or load
 * balancer. When `X-Forwarded-For` is absent (direct connection with no upstream
 * proxy), it is initialised from `event.getClientAddress()` so the auth server
 * always receives origin information. `X-Forwarded-Host` and `X-Forwarded-Proto`
 * are set only when absent, preserving values injected by an upstream CDN.
 *
 * @param event - The current SvelteKit request event.
 * @returns A `Headers` instance safe to forward to the upstream service.
 */
function buildUpstreamHeaders(event: RequestEvent): Headers {
  const headers = new Headers();
  for (const [key, value] of event.request.headers) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || INTERNAL_HEADERS.has(lower)) {
      continue;
    }
    headers.set(key, value);
  }

  // Always append the direct client IP to the X-Forwarded-For chain so the
  // upstream auth server sees the full proxy path. We never skip this even when
  // a chain is already present — a load balancer may have set XFF before the
  // request reached this server, and our hop must still be recorded.
  let clientIp: string | undefined;
  try {
    clientIp = event.getClientAddress();
  } catch {
    // getClientAddress throws when the platform adapter cannot resolve a
    // client address; treat that as "no IP" rather than failing the proxy.
    clientIp = undefined;
  }
  if (clientIp) {
    const existingXff = headers.get("x-forwarded-for");
    headers.set("x-forwarded-for", existingXff ? `${existingXff}, ${clientIp}` : clientIp);
  }

  if (!headers.has("x-forwarded-host")) {
    headers.set("x-forwarded-host", event.url.host);
  }

  if (!headers.has("x-forwarded-proto")) {
    headers.set("x-forwarded-proto", event.url.protocol.replace(":", ""));
  }

  return headers;
}

/**
 * Forwards a `/__nextgen/*` request to the upstream auth backend and returns
 * the upstream response verbatim, including `Set-Cookie` headers. Hop-by-hop
 * and `location` headers are stripped in both directions.
 *
 * @param event     - The current SvelteKit request event.
 * @param authUrl   - Base URL of the auth backend.
 * @param proxyPath - The path prefix being proxied (e.g. `"/__nextgen"`).
 * @returns The proxied upstream `Response`.
 */
async function proxyRequest(
  event: RequestEvent,
  authUrl: string,
  proxyPath: string,
  projectSecret: string | undefined,
  proxyTimeoutMs: number,
): Promise<Response> {
  const { url } = event;
  const suffix = url.pathname.slice(proxyPath.length);
  const target = `${authUrl}${suffix}${url.search}`;

  const method = event.request.method;
  const hasBody = !["GET", "HEAD"].includes(method);
  // Read the body eagerly so the upstream fetch receives a concrete buffer
  // rather than a streaming body (which would require the `duplex` option and
  // is not supported uniformly across platform adapters).
  const body = hasBody ? await event.request.arrayBuffer() : undefined;

  const upstreamHeaders = buildUpstreamHeaders(event);

  // Attach the project service-key secret as the bearer on every proxied
  // request. The secret is read server-side from `ZITADEL_PROJECT_SECRET`
  // (passed via `createNextgenHandle({ projectSecret })`) and never reaches the
  // browser — this handle runs only on the server.
  if (!upstreamHeaders.has("authorization") && projectSecret) {
    upstreamHeaders.set("authorization", `Bearer ${projectSecret}`);
  }

  const upstream = await fetch(target, {
    method,
    headers: upstreamHeaders,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(proxyTimeoutMs),
  });

  const responseHeaders = filterResponseHeaders(upstream.headers);

  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

const DECODER = new TextDecoder();

/**
 * Returns `true` when `token` looks structurally like a signed JWT (JWS) —
 * NOT an encrypted token (JWE).
 *
 * JWS compact: 3 dot-separated segments; header has `alg` but NOT `enc`.
 * JWE compact: 5 dot-separated segments; header has BOTH `alg` and `enc`.
 *
 * Our backend issues JWE tokens (AES-256-GCM via go-jose `A256GCMKW/A256GCM`),
 * whose compact form is `header.encrypted_key.iv.ciphertext.tag`. The header
 * decodes to JSON with `"alg":"A256GCMKW","enc":"A256GCM"`. Checking for the
 * absence of `enc` correctly identifies signed JWTs without false-positives on
 * JWE tokens.
 *
 * This is a structural check only — not a security check.
 */
function isJwtShaped(token: string): boolean {
  const parts = token.split(".");
  if (parts.length < 3 || !parts[0]) return false;
  try {
    const header = JSON.parse(DECODER.decode(base64UrlDecode(parts[0]))) as Record<string, unknown>;
    return typeof header?.alg === "string" && !("enc" in header);
  } catch {
    return false;
  }
}

/**
 * Validates an opaque (non-JWT) session token by calling the backend's
 * `/sessions/me` endpoint. Returns the response JSON when the backend
 * confirms the session is live (HTTP 200), `null` otherwise.
 *
 * This is the fallback path for backends that issue encrypted opaque tokens
 * rather than self-contained JWTs.
 */
async function validateOpaqueSessionToken(
  token: string,
  issuerUrl: string,
  timeoutMs: number,
): Promise<{ userId?: string } | null> {
  try {
    const res = await fetch(`${issuerUrl}/sessions/me`, {
      method: "GET",
      headers: { cookie: `__nextgen_session=${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { user_id?: string };
    return { userId: body.user_id };
  } catch {
    return null;
  }
}

/**
 * Options passed internally to {@link handleAuth} after destructuring the
 * public-facing {@link NextgenMiddlewareOptions}.
 */
interface AuthHandlerOptions {
  readonly url: string;
  readonly protectedRoutes: readonly string[];
  readonly loginPath: string;
  readonly allowedAlgorithms: readonly string[] | undefined;
  readonly clockSkewMs: number;
  readonly audience: string | readonly string[] | undefined;
  readonly allowedTokenTypes: readonly string[];
  readonly jwksTimeoutMs: number | undefined;
  readonly opaqueTokenTimeoutMs: number;
}

/**
 * Builds a `Set-Cookie` header value that clears `name` on the root path.
 * Used to evict stale `__nextgen*` cookies when a session token is present
 * but no longer valid.
 */
function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0`;
}

/**
 * Verifies the session token, writes the auth result to `event.locals`, and
 * either continues the request (`resolve`) or redirects to the login page on a
 * protected route with no valid session. Stale `__nextgen*` cookies are cleared
 * when the token is present but invalid.
 *
 * @param event   - The current SvelteKit request event.
 * @param resolve - The downstream resolver from the `handle` hook.
 * @param opts    - Auth handler options.
 * @returns The response to send.
 */
async function handleAuth(
  event: RequestEvent,
  resolve: (event: RequestEvent) => Promise<Response> | Response,
  opts: AuthHandlerOptions,
): Promise<Response> {
  const {
    url,
    protectedRoutes,
    loginPath,
    allowedAlgorithms,
    clockSkewMs,
    audience,
    allowedTokenTypes,
    jwksTimeoutMs,
    opaqueTokenTimeoutMs,
  } = opts;
  const { pathname } = event.url;

  // Strip any client-supplied x-nextgen-auth-token from the inbound request so
  // load functions and endpoints cannot observe an attacker-controlled value by
  // reading the raw request headers. The canonical auth state is
  // event.locals.nextgenAuth; consumers should call getAuth(event) instead.
  // Request headers may be immutable on some adapters — guard the delete.
  try {
    event.request.headers.delete("x-nextgen-auth-token");
  } catch {
    // Immutable headers: nothing to strip beyond what the proxy path already
    // drops via INTERNAL_HEADERS before forwarding upstream.
  }

  const authHeader = event.request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieToken = event.cookies.get("__nextgen_session") ?? null;
  // Bearer token takes explicit precedence over the session cookie. API clients
  // (e.g. mobile apps, CLIs) use Authorization headers while browsers use
  // cookies; when both are present the caller clearly intended the Bearer token.
  const token = bearerToken ?? cookieToken;

  const payload = token
    ? await verifyJwt(token, {
        issuerUrl: url,
        allowedAlgorithms,
        clockSkewMs,
        audience,
        allowedTokenTypes,
        jwksTimeoutMs,
      })
    : null;

  if (payload && token && payload.sub) {
    event.locals.nextgenAuth = {
      isAuthenticated: true,
      session: {
        userId: payload.sub,
        email: payload.email ?? null,
        name: payload.name ?? null,
        token,
      },
    };
    return resolve(event);
  }

  // The backend issues opaque encrypted session tokens rather than JWTs.
  // Only fall back to /sessions/me validation when the token is definitively
  // not a JWT (non-JSON segments). A token with a valid JWT structure that
  // failed verification (bad sig, wrong typ/alg) must be rejected.
  if (!payload && cookieToken && !isJwtShaped(cookieToken)) {
    const opaqueResult = await validateOpaqueSessionToken(cookieToken, url, opaqueTokenTimeoutMs);
    if (opaqueResult) {
      event.locals.nextgenAuth = {
        isAuthenticated: true,
        session: {
          userId: opaqueResult.userId ?? "unknown",
          email: null,
          name: null,
          token: cookieToken,
        },
      };
      return resolve(event);
    }
  }

  event.locals.nextgenAuth = { isAuthenticated: false, session: null };

  const staleCookies = event.cookies
    .getAll()
    .filter((c) => c.name.startsWith("__nextgen"))
    .map((c) => c.name);

  if (matchesRoutes(pathname, protectedRoutes)) {
    const loginUrl = new URL(loginPath, event.url);
    loginUrl.searchParams.set("next", pathname);
    const headers = new Headers({ location: loginUrl.toString() });
    for (const name of staleCookies) {
      headers.append("set-cookie", clearCookie(name));
    }
    return new Response(null, { status: 302, headers });
  }

  // Clear stale cookies on the continued response too. SvelteKit applies
  // `event.cookies` mutations to the response produced by `resolve`, so deleting
  // here propagates the clearing Set-Cookie headers.
  for (const name of staleCookies) {
    event.cookies.delete(name, { path: "/" });
  }
  return resolve(event);
}

/**
 * Creates a SvelteKit {@link Handle} hook that handles proxying, JWT
 * verification, and route protection in a single pass.
 *
 * Place it in `src/hooks.server.ts`:
 *
 * ```ts
 * import { createNextgenHandle } from "@zitadel/sdk-sveltekit/server";
 * import { env } from "$env/dynamic/private";
 *
 * export const handle = createNextgenHandle({
 *   url: env.ZITADEL_URL,
 *   projectSecret: env.ZITADEL_PROJECT_SECRET,
 *   protectedRoutes: ["/admin*", "/dashboard*"],
 *   loginPath: "/login",
 * });
 * ```
 *
 * Compose it with other hooks via `sequence()` from `@sveltejs/kit/hooks`.
 *
 * @param options - Middleware configuration options. `projectSecret` is the
 *   project service-key forwarded as the bearer on proxied requests.
 * @returns A SvelteKit `Handle` hook.
 */
export function createNextgenHandle(
  options: NextgenMiddlewareOptions & { projectSecret?: string } = {},
): Handle {
  const {
    url = process.env.ZITADEL_URL ?? "http://localhost:8080",
    proxyPath = "/__nextgen",
    protectedRoutes = [],
    ignoredRoutes = [],
    loginPath = "/login",
    allowedAlgorithms = ["RS256", "ES256"] as const,
    clockSkewMs = 5000,
    audience,
    allowedTokenTypes = ["JWT", "at+JWT"],
    jwksTimeoutMs,
    proxyTimeoutMs = 5000,
    opaqueTokenTimeoutMs = 5000,
    projectSecret = process.env.ZITADEL_PROJECT_SECRET,
  } = options;

  // Guard against open-redirect: loginPath must be a relative path. An absolute
  // URL (e.g. "https://evil.com/phish") or a protocol-relative URL
  // (e.g. "//evil.com") would redirect the browser to an external host.
  if (!loginPath.startsWith("/") || loginPath.startsWith("//")) {
    throw new Error(
      `[nextgen] loginPath must be a relative path starting with a single "/". ` +
        `Received: "${loginPath}". Using an absolute or protocol-relative URL ` +
        `would allow open-redirect attacks.`,
    );
  }

  return async ({ event, resolve }) => {
    const { pathname } = event.url;

    if (matchesRoutes(pathname, ignoredRoutes)) {
      // Neutralise any client-supplied x-nextgen-auth-token on ignored routes.
      try {
        event.request.headers.delete("x-nextgen-auth-token");
      } catch {
        // Immutable headers on this adapter — nothing to strip.
      }
      return resolve(event);
    }

    if (pathname === proxyPath || pathname.startsWith(`${proxyPath}/`)) {
      return proxyRequest(event, url, proxyPath, projectSecret, proxyTimeoutMs);
    }

    return handleAuth(event, resolve, {
      url,
      protectedRoutes,
      loginPath,
      allowedAlgorithms,
      clockSkewMs,
      audience,
      allowedTokenTypes,
      jwksTimeoutMs,
      opaqueTokenTimeoutMs,
    });
  };
}

/**
 * Reads the auth state from a SvelteKit request event inside a load function,
 * endpoint, or action after the {@link createNextgenHandle} hook has run.
 *
 * ```ts
 * import { getAuth } from "@zitadel/sdk-sveltekit/server";
 *
 * export const load = (event) => {
 *   const auth = getAuth(event);
 *   if (!auth.isAuthenticated) throw redirect(302, "/login");
 *   return { userId: auth.session.userId };
 * };
 * ```
 *
 * @param event - The current SvelteKit request event.
 * @returns The current {@link AuthResult}.
 */
export function getAuth(event: RequestEvent): AuthResult {
  return event.locals.nextgenAuth ?? { isAuthenticated: false, session: null };
}
