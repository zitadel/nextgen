import type {
  AuthResult,
  NextgenMiddlewareOptions,
  ResolveSessionOptions,
} from "@zitadel/sdk-core/middleware";
import { joinURL } from "ufo";
import type { EventHandler, H3Event } from "h3";

import { useRuntimeConfig } from "#imports";
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
import {
  defineEventHandler,
  getCookie,
  appendResponseHeader,
  setResponseHeader,
  sendRedirect,
  getRequestURL,
  getRequestHeader,
  getRequestHeaders,
  getRequestIP,
  getMethod,
  setResponseStatus,
  toWebRequest,
} from "h3";

import { resolveProjectSecret, resolveUrl } from "../lib/settings";

declare module "h3" {
  interface H3EventContext {
    /**
     * Set by the middleware on every request it runs for. Absent where it did
     * not run (an ignored route, a handler outside its reach), so read it
     * through {@link getAuth}, which answers signed out then.
     */
    nextgenAuth?: AuthResult;
  }
}

/**
 * Builds the set of upstream request headers by copying all incoming headers,
 * dropping hop-by-hop headers, and setting `X-Forwarded-*` headers so the
 * upstream auth server can see the real client origin.
 *
 * All non-hop-by-hop headers from the incoming request are forwarded as-is,
 * including any `X-Forwarded-For` chain already set by an upstream CDN or load
 * balancer. When `X-Forwarded-For` is absent (direct connection with no upstream
 * proxy), it is initialised from the raw socket address so the auth server always
 * receives origin information. `X-Forwarded-Host` and `X-Forwarded-Proto` are set
 * only when absent, preserving values injected by an upstream CDN.
 *
 * The request is read through h3's accessors, never `event.node`, so this runs
 * wherever Nitro does: h3 joins a repeated header with `", "` into one value.
 *
 * @param event - The current H3 event.
 * @returns A `Headers` instance safe to forward to the upstream service.
 */
function buildUpstreamHeaders(event: H3Event): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(getRequestHeaders(event))) {
    const lower = key.toLowerCase();
    if (!value || HOP_BY_HOP.has(lower) || INTERNAL_HEADERS.has(lower)) {
      continue;
    }
    headers.set(key, value);
  }

  const url = getRequestURL(event);

  // Always append the direct socket IP to the X-Forwarded-For chain so the
  // upstream auth server sees the full proxy path. We never skip this even when
  // a chain is already present — a load balancer may have set XFF before the
  // request reached this Nitro server, and our hop must still be recorded.
  // `getRequestIP` without `xForwardedFor` answers the address the runtime
  // reports for the connection, never a client-supplied header.
  const socketIp = getRequestIP(event);
  if (socketIp) {
    const existingXff = headers.get("x-forwarded-for");
    headers.set("x-forwarded-for", existingXff ? `${existingXff}, ${socketIp}` : socketIp);
  }

  if (!headers.has("x-forwarded-host")) {
    headers.set("x-forwarded-host", url.host);
  }

  if (!headers.has("x-forwarded-proto")) {
    headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
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
 * import { createNextgenMiddleware } from "@zitadel/sdk-nuxt/server";
 *
 * export default createNextgenMiddleware({
 *   url: process.env.ZITADEL_URL,
 *   protectedRoutes: ["/admin*", "/dashboard*"],
 *   loginPath: "/login",
 * });
 * ```
 *
 * A session counts only in the app's own project: `projectId`, else
 * `ZITADEL_PROJECT_ID`, else `NUXT_PUBLIC_ZITADEL_PROJECT_ID`. The module's
 * handler passes `nextgen.projectId`, else the public project id.
 *
 * @param options - Middleware configuration options.
 * @returns An H3 event handler suitable for use as a global server middleware.
 */
export function createNextgenMiddleware(options: NextgenMiddlewareOptions = {}): EventHandler {
  const {
    projectId = process.env.ZITADEL_PROJECT_ID || process.env.NUXT_PUBLIC_ZITADEL_PROJECT_ID,
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
  } = options;

  // An empty `url` (the module's runtime config holds `""` until a value is
  // set) counts as unset, so it falls back to `ZITADEL_URL`, then the default.
  const url = resolveUrl({ url: options.url });

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

  return defineEventHandler(async (event: H3Event) => {
    // Clients never send x-nextgen-auth-token: it is an internal channel. Refuse any
    // request that carries it, on every route, before anything else runs.
    if (getRequestHeader(event, "x-nextgen-auth-token") !== undefined) {
      setResponseStatus(event, 400);
      return "Bad Request";
    }

    const urlObj = getRequestURL(event);
    const { pathname } = urlObj;

    if (matchesRoutes(pathname, ignoredRoutes)) {
      return;
    }

    if (pathname === proxyPath || pathname.startsWith(`${proxyPath}/`)) {
      return proxyRequest(event, url, proxyPath, urlObj, projectId, proxyTimeoutMs);
    }

    return handleAuth(event, {
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
      pathname,
    });
  });
}

/**
 * Forwards a `/__nextgen/*` request to the upstream auth backend and streams
 * the response back, including its `Set-Cookie` headers. Hop-by-hop headers are
 * stripped in both directions, and the session cookie travels under this
 * project's name in the browser and the server's name upstream
 * ({@link proxySessionCookies}).
 *
 * @param event      - The current H3 event.
 * @param authUrl    - Base URL of the auth backend.
 * @param proxyPath  - The path prefix being proxied (e.g. `"/__nextgen"`).
 * @param url        - The parsed request URL.
 * @param projectId  - The project this app signs its users in to.
 * @returns The upstream response body stream.
 */
async function proxyRequest(
  event: H3Event,
  authUrl: string,
  proxyPath: string,
  url: URL,
  projectId: string | undefined,
  proxyTimeoutMs: number,
): Promise<ReadableStream<Uint8Array> | null> {
  const suffix = url.pathname.slice(proxyPath.length);
  const target = `${joinURL(authUrl, suffix)}${url.search}`;

  const method = getMethod(event);
  const hasBody = !["GET", "HEAD"].includes(method);
  // Read through the web Request, as `Buffer` is not there on every runtime.
  const rawBody = hasBody ? await toWebRequest(event).arrayBuffer() : undefined;
  const body =
    rawBody !== undefined && rawBody.byteLength > 0 ? new Uint8Array(rawBody) : undefined;

  const upstreamHeaders = buildUpstreamHeaders(event);
  const sessionCookies = proxySessionCookies(
    {
      method,
      path: suffix,
      search: url.search,
      cookie: getRequestHeader(event, "cookie") ?? null,
      requestUrl: url,
      forwardedProto: getRequestHeader(event, "x-forwarded-proto") ?? null,
      forwardedHost: getRequestHeader(event, "x-forwarded-host") ?? null,
    },
    projectId,
    { url: authUrl, timeoutMs: proxyTimeoutMs },
  );
  if (sessionCookies.upstreamCookie === null) {
    upstreamHeaders.delete("cookie");
  } else {
    upstreamHeaders.set("cookie", sessionCookies.upstreamCookie);
  }

  // ADR 036: the current browser flow needs the confidential project secret
  // only for the handoff exchange. Never make the public proxy an
  // operator-capable relay, and preserve an explicit caller credential for
  // the future publishable-key exchange path.
  if (requiresProjectSecret(method, suffix) && !upstreamHeaders.has("authorization")) {
    const config = useRuntimeConfig();
    const projectSecret = resolveProjectSecret(config.nextgen);
    if (projectSecret) {
      upstreamHeaders.set("authorization", `Bearer ${projectSecret}`);
    }
  }

  const upstream = await fetch(target, {
    method,
    headers: upstreamHeaders,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(proxyTimeoutMs),
  });

  // Build a web-standard Response with filtered headers. This is the
  // canonical representation — we write it to the h3 event at the end.
  // The app's own request URL: the origin a proxied redirect may name, and
  // the base a relative one resolves against.
  const responseHeaders = filterResponseHeaders(upstream.headers, getRequestURL(event).toString());

  const answer = await sessionCookies.toBrowser(upstream);
  for (const cookie of answer.setCookies) {
    responseHeaders.append("set-cookie", cookie);
  }
  if (answer.setCookies.length > 0) {
    responseHeaders.set("cache-control", SESSION_COOKIE_CACHE_CONTROL);
  }

  const response = new Response(answer.body, {
    status: upstream.status,
    headers: responseHeaders,
  });

  // Write the response to the H3 event.
  setResponseStatus(event, response.status);
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === "set-cookie") continue;
    setResponseHeader(event, key, value);
  }
  // Use getSetCookie() so multiple Set-Cookie values aren't collapsed.
  const finalCookies = response.headers.getSetCookie?.() ?? [];
  for (const cookie of finalCookies) {
    appendResponseHeader(event, "set-cookie", cookie);
  }

  return response.body;
}

/**
 * Options passed internally to {@link handleAuth} after destructuring the
 * public-facing {@link NextgenMiddlewareOptions}: the route policy, plus what
 * the shared {@link resolveSession} judges the session by.
 */
interface AuthHandlerOptions extends ResolveSessionOptions {
  readonly protectedRoutes: readonly string[];
  readonly loginPath: string;
  readonly pathname: string;
}

/**
 * Judges the session and writes the auth result to `event.context`, sets the
 * session cookies the judgement asks for, and redirects to the login page on
 * protected routes when nobody is signed in. When the backend cannot say
 * whether the session is live, a protected route answers `503` instead.
 *
 * @param event - The current H3 event.
 * @param opts  - Auth handler options.
 * @returns The body of a response this handler answers itself, if any.
 */
async function handleAuth(event: H3Event, opts: AuthHandlerOptions): Promise<string | undefined> {
  const { protectedRoutes, loginPath, pathname, ...verification } = opts;

  const authHeader = getRequestHeader(event, "authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const { auth, undecided, cookies } = await resolveSession(
    {
      bearer: bearerToken,
      cookie: (name) => getCookie(event, name),
      requestUrl: getRequestURL(event),
      forwardedProto: getRequestHeader(event, "x-forwarded-proto") ?? null,
      forwardedHost: getRequestHeader(event, "x-forwarded-host") ?? null,
    },
    verification,
  );

  event.context.nextgenAuth = auth;

  // The backend could not say whether the session is live. The user may well
  // be signed in, so a protected route answers 503 rather than send them to
  // the login page.
  if (undecided && matchesRoutes(pathname, protectedRoutes)) {
    setResponseStatus(event, 503);
    return "Service Unavailable";
  }

  // A dead session's cookie is cleared so the browser stops replaying it, and a
  // session of this project still under the shared name is copied to the
  // project's own cookie. A live session that signs no one in here (an
  // anonymous one, whose sign-in may still complete, or one of another project)
  // keeps its cookie, and so does one the backend gave no verdict on.
  for (const cookie of cookies) {
    appendResponseHeader(event, "set-cookie", serializeSessionCookie(cookie));
  }
  if (cookies.length > 0) {
    setResponseHeader(event, "cache-control", SESSION_COOKIE_CACHE_CONTROL);
  }

  if (!auth.isAuthenticated && matchesRoutes(pathname, protectedRoutes)) {
    await sendRedirect(event, loginRedirectUrl(loginPath, getRequestURL(event)).toString(), 302);
  }
  return undefined;
}

/**
 * Reads the auth state from a Nitro/H3 event context.
 *
 * Call this inside any server route or API handler after the middleware has run:
 *
 * ```ts
 * import { getAuth } from "@zitadel/sdk-nuxt/server";
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
