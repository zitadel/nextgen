import type { RequestEvent } from "@sveltejs/kit";
import type {
  AuthResult,
  NextgenMiddlewareOptions,
  ResolveSessionOptions,
} from "@zitadel/sdk-core/middleware";

import {
  HOP_BY_HOP,
  INTERNAL_HEADERS,
  filterResponseHeaders,
  loginRedirectUrl,
  matchesRoutes,
  proxySessionCookies,
  SESSION_COOKIE_CACHE_CONTROL,
  requiresProjectSecret,
  resolveSession,
  serializeSessionCookie,
} from "@zitadel/sdk-core/middleware";

/**
 * `process` is undefined in some edge/serverless runtimes; read env defensively
 * so omitting `url`/`projectSecret` falls back to the default instead of throwing
 * a ReferenceError.
 */
const PROCESS_ENV: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? process.env : {};

/**
 * A SvelteKit `handle` hook, typed structurally from `RequestEvent`. Kit 2
 * exports `Handle` from `@sveltejs/kit`; Kit 3 declares it only under
 * `@sveltejs/kit/hooks`, so importing it would type the hook as `any` there.
 * `RequestEvent` is exported from `@sveltejs/kit` on both majors, and this shape
 * is assignable to either `Handle` (it accepts a `resolve` with an options
 * argument, and never passes one).
 */
export type NextgenHandle = (input: {
  event: RequestEvent;
  resolve: (event: RequestEvent) => Promise<Response> | Response;
}) => Promise<Response>;

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
 * the upstream response, including its `Set-Cookie` headers. Hop-by-hop
 * headers are stripped in both directions, a `location` is kept only as a
 * redirect onto this app, and the session cookie travels under this project's
 * name in the browser and the server's name upstream
 * ({@link proxySessionCookies}).
 *
 * @param event     - The current SvelteKit request event.
 * @param authUrl   - Base URL of the auth backend.
 * @param proxyPath - The path prefix being proxied (e.g. `"/__nextgen"`).
 * @param projectId - The project this app signs its users in to.
 * @returns The proxied upstream `Response`.
 */
async function proxyRequest(
  event: RequestEvent,
  authUrl: string,
  proxyPath: string,
  projectId: string | undefined,
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
  const sessionCookies = proxySessionCookies(
    {
      method,
      path: suffix,
      search: url.search,
      cookie: event.request.headers.get("cookie"),
      requestUrl: url,
      forwardedProto: event.request.headers.get("x-forwarded-proto"),
      forwardedHost: event.request.headers.get("x-forwarded-host"),
    },
    projectId,
    { url: authUrl, timeoutMs: proxyTimeoutMs },
  );
  if (sessionCookies.upstreamCookie === null) {
    upstreamHeaders.delete("cookie");
  } else {
    upstreamHeaders.set("cookie", sessionCookies.upstreamCookie);
  }

  // ADR 036: attach the project secret only to the handoff exchange — on every
  // operation it would make this public boundary an open relay with project
  // authority. A caller-supplied credential is preserved.
  if (
    requiresProjectSecret(method, suffix) &&
    !upstreamHeaders.has("authorization") &&
    projectSecret
  ) {
    upstreamHeaders.set("authorization", `Bearer ${projectSecret}`);
  }

  const upstream = await fetch(target, {
    method,
    headers: upstreamHeaders,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(proxyTimeoutMs),
  });

  // The app's own request URL: the origin a proxied redirect may name, and the
  // base a relative one resolves against (the IdP callback's 303 needs it).
  const responseHeaders = filterResponseHeaders(upstream.headers, url.toString());

  const answer = await sessionCookies.toBrowser(upstream);
  for (const cookie of answer.setCookies) {
    responseHeaders.append("set-cookie", cookie);
  }
  if (answer.setCookies.length > 0) {
    responseHeaders.set("cache-control", SESSION_COOKIE_CACHE_CONTROL);
  }

  return new Response(answer.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

/**
 * Options passed internally to {@link handleAuth} after destructuring the
 * public-facing {@link NextgenMiddlewareOptions}: the route policy, plus what
 * the shared {@link resolveSession} judges the session by.
 */
interface AuthHandlerOptions extends ResolveSessionOptions {
  readonly protectedRoutes: readonly string[];
  readonly loginPath: string;
}

/**
 * Verifies the session token, writes the auth result to `event.locals`, and
 * either continues the request (`resolve`) or redirects to the login page on a
 * protected route with no valid session. Either way the response carries the
 * session cookies the judgement asks for. When the backend cannot say whether
 * the session is live, a protected route answers `503` instead.
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
  const { protectedRoutes, loginPath, ...verification } = opts;
  const { pathname } = event.url;

  const authHeader = event.request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const {
    auth,
    undecided,
    cookies: sessionCookies,
  } = await resolveSession(
    {
      bearer: bearerToken,
      cookie: (name) => event.cookies.get(name),
      requestUrl: event.url,
      forwardedProto: event.request.headers.get("x-forwarded-proto"),
      forwardedHost: event.request.headers.get("x-forwarded-host"),
    },
    verification,
  );

  event.locals.nextgenAuth = auth;

  // The backend could not say whether the session is live. The user may well
  // be signed in, so a protected route answers 503 rather than send them to
  // the login page.
  if (undecided && matchesRoutes(pathname, protectedRoutes)) {
    return new Response("Service Unavailable", { status: 503 });
  }

  // A dead session's cookie is cleared so the browser stops replaying it, and a
  // session of this project still under the shared name is copied to the
  // project's own cookie. A live session that signs no one in here (an
  // anonymous one, whose sign-in may still complete, or one of another project)
  // keeps its cookie, and so does one the backend gave no verdict on.
  if (!auth.isAuthenticated && matchesRoutes(pathname, protectedRoutes)) {
    const headers = new Headers({ location: loginRedirectUrl(loginPath, event.url).toString() });
    for (const cookie of sessionCookies) {
      headers.append("set-cookie", serializeSessionCookie(cookie));
    }
    if (sessionCookies.length > 0) {
      headers.set("cache-control", SESSION_COOKIE_CACHE_CONTROL);
    }
    return new Response(null, { status: 302, headers });
  }

  // SvelteKit applies `event.cookies` changes to the response `resolve`
  // produces, whose headers may be immutable. Every attribute is given: left
  // out, SvelteKit adds `Secure` on its own, which Safari drops over plain http
  // to 127.0.0.1 and [::1].
  for (const cookie of sessionCookies) {
    const attributes = {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: cookie.secure,
    } as const;
    if (cookie.maxAge === 0) {
      event.cookies.delete(cookie.name, attributes);
    } else {
      event.cookies.set(cookie.name, cookie.value, {
        ...attributes,
        ...(cookie.maxAge === undefined ? {} : { maxAge: cookie.maxAge }),
        // The value is the server's token, sent back as the server sent it.
        encode: (value) => value,
      });
    }
  }
  const response = await resolve(event);
  return sessionCookies.length > 0 ? withNoStore(response) : response;
}

/**
 * `response` with {@link SESSION_COOKIE_CACHE_CONTROL}, so a shared cache keeps
 * no session cookie it sets. It is set on the response, not through
 * `event.setHeaders`, which fails the request when a page sets the header too;
 * a response whose headers are immutable is copied.
 */
function withNoStore(response: Response): Response {
  try {
    response.headers.set("cache-control", SESSION_COOKIE_CACHE_CONTROL);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    copy.headers.set("cache-control", SESSION_COOKIE_CACHE_CONTROL);
    return copy;
  }
}

/**
 * Creates a SvelteKit {@link NextgenHandle} hook that handles proxying, JWT
 * verification, and route protection in a single pass.
 *
 * Place it in `src/hooks.server.ts`:
 *
 * ```ts
 * import { createNextgenHandle } from "@zitadel/sdk-sveltekit/server";
 *
 * // SvelteKit does not surface .env files on process.env; load it in dev.
 * try {
 *   process.loadEnvFile?.(".env.local");
 * } catch {}
 *
 * export const handle = createNextgenHandle({
 *   protectedRoutes: ["/admin*", "/dashboard*"],
 *   loginPath: "/login",
 * });
 * ```
 *
 * `url` and `projectSecret` default to `ZITADEL_URL` / `ZITADEL_PROJECT_SECRET`
 * from `process.env` (version-independent, unlike SvelteKit's `$env` modules).
 * A session counts only in the app's own project: `projectId`, else
 * `ZITADEL_PROJECT_ID`, else `VITE_ZITADEL_PROJECT_ID`.
 * Compose it with other hooks via `sequence()` from `@sveltejs/kit/hooks`.
 *
 * @param options - Middleware configuration options. `projectSecret` is the
 *   project service-key, sent as the bearer on the `POST /sessions/exchange` handoff only.
 * @returns A SvelteKit `handle` hook.
 */
export function createNextgenHandle(
  options: NextgenMiddlewareOptions & { projectSecret?: string } = {},
): NextgenHandle {
  const {
    url = PROCESS_ENV.ZITADEL_URL ?? "http://localhost:8080",
    projectId = PROCESS_ENV.ZITADEL_PROJECT_ID || PROCESS_ENV.VITE_ZITADEL_PROJECT_ID,
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
    projectSecret = PROCESS_ENV.ZITADEL_PROJECT_SECRET,
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

    // Clients never send x-nextgen-auth-token: it is an internal channel. Refuse any
    // request that carries it, on every route, before anything else runs.
    if (event.request.headers.has("x-nextgen-auth-token")) {
      return new Response("Bad Request", { status: 400 });
    }

    if (matchesRoutes(pathname, ignoredRoutes)) {
      return resolve(event);
    }

    if (pathname === proxyPath || pathname.startsWith(`${proxyPath}/`)) {
      return proxyRequest(event, url, proxyPath, projectId, projectSecret, proxyTimeoutMs);
    }

    return handleAuth(event, resolve, {
      url,
      projectId,
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
