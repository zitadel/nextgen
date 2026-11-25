import type {
  AuthResult,
  ZitadelMiddlewareOptions,
  ProxyRoute,
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
  proxyRoute,
  proxySessionCookies,
  refusedProxyResponse,
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
  sendWebResponse,
  setResponseStatus,
  toWebRequest,
} from "h3";

import { resolveProjectSecret, resolveUrl } from "../lib/settings";

/**
 * The process environment, or an empty map when there is none.
 *
 * `process` is undefined in some edge and serverless runtimes, so the environment is read
 * defensively and the fallback never throws a `ReferenceError`.
 */
const PROCESS_ENV: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? process.env : {};

declare module "h3" {
  interface H3EventContext {
    /**
     * The verified session of the request.
     *
     * The middleware sets it on every request it judges. It is absent where the middleware did
     * not run, for example on an ignored route or in a handler outside its reach, so read it
     * through {@link getAuth}, which answers signed out in that case.
     */
    zitadelAuth?: AuthResult;
  }
}

/**
 * Builds the request headers sent to the backend.
 *
 * It copies the incoming headers, drops the hop-by-hop headers and the internal ones, and sets
 * `X-Forwarded-*` so the backend sees the real client origin. An `X-Forwarded-For` chain that a
 * CDN or load balancer already set is kept, and the socket address of this hop is appended, so the
 * backend sees the full proxy path. `X-Forwarded-Host` and `X-Forwarded-Proto` are set only when
 * absent, which preserves values that an upstream CDN injected. The socket address comes from the
 * runtime, never from a client-supplied header.
 *
 * The request is read through h3's accessors, never `event.node`, so this runs wherever Nitro
 * does. h3 joins a repeated header into one value with `", "`.
 *
 * @param event - The current H3 event.
 * @returns The headers to forward to the backend.
 */
function buildUpstreamHeaders(event: H3Event): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(getRequestHeaders(event))) {
    const lower = key.toLowerCase();
    if (value === undefined || HOP_BY_HOP.has(lower) || INTERNAL_HEADERS.has(lower)) {
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
 * Creates the H3 event handler that proxies, verifies the session and protects routes in one
 * pass.
 *
 * Use it when the app registers the middleware itself in `server/middleware`. An app that adds
 * the `@zitadel/sdk-nuxt/module` module does not call it, because the module registers an
 * equivalent handler that reads its options from the runtime config.
 *
 * For each request the handler works in this order:
 *
 * 1. A request that carries the internal `x-zitadel-auth-token` header is refused with `400`.
 *    Clients never send it, and it is checked on every route, before anything else, so it cannot
 *    be used to inject a session.
 * 2. A path that matches `ignoredRoutes` is skipped: no proxy, no verification, no protection.
 * 3. A path under `proxyPath` is forwarded to the backend on the app's own origin, so the
 *    browser calls only the app and the widgets need no CORS setup.
 * 4. Any other request has its session judged from the session cookie or a `Bearer` token. The
 *    result is stored for {@link getAuth}. On a path in `protectedRoutes`, a visitor who is not
 *    signed in is redirected with `302` to `loginPath`, with the requested path in `next`. When
 *    the backend cannot say whether the session is live, the protected route answers `503`
 *    instead, because the user may well be signed in.
 *
 * A session counts only in the app's own project: `projectId`, else `ZITADEL_PROJECT_ID`, else
 * `NUXT_PUBLIC_ZITADEL_PROJECT_ID`. A session of another project reads as signed out, and its
 * cookie is left alone. With no project configured, nobody is signed in.
 *
 * The cookie travels in the browser under this project's own name, so two apps on one host do not
 * share a session. A cookie whose session the backend says is dead is cleared, and one the backend
 * gave no verdict on is kept.
 *
 * The factory works on Node and on edge runtimes such as Cloudflare Workers and Vercel Edge.
 *
 * Naming: Nuxt calls these server middleware: a file in server/middleware that default-exports
 * an h3 event handler. This factory returns that handler. It is a factory, called once, so it
 * starts with create.
 *
 * A signed-out request for a protected route is redirected with an absolute URL on the origin of
 * the request, such as `https://app.example.com/login?next=%2Fadmin`.
 *
 * The proxy forwards a client's `x-forwarded-host` and `x-forwarded-proto` unchanged and sets them
 * from the request only when the client sent none. It cannot tell a trusted CDN or load balancer
 * from a client, and the server builds the OAuth issuer and the `Secure` decision for session
 * cookies from those headers, so strip them at the edge when clients can reach the app directly.
 *
 * @param options - The middleware options, described by {@link ZitadelMiddlewareOptions}. Every
 *   field is optional. An empty `url` counts as unset and falls back to `ZITADEL_URL`, then
 *   `http://localhost:8080`. The `projectSecret` wins over `NUXT_ZITADEL_PROJECT_SECRET` and
 *   `ZITADEL_PROJECT_SECRET`, and an empty value counts as unset.
 * @returns An H3 event handler suitable as a global server middleware.
 * @throws When `loginPath` is not a relative path starting with a single `/` with no backslash. An absolute or
 *   protocol-relative URL would allow an open redirect.
 *
 * @example
 * ```ts
 * // server/middleware/auth.ts
 * import { createZitadelMiddleware } from "@zitadel/sdk-nuxt/server";
 *
 * export default createZitadelMiddleware({
 *   url: process.env.ZITADEL_URL,
 *   protectedRoutes: ["/admin*", "/dashboard*"],
 *   loginPath: "/login",
 * });
 * ```
 */
export function createZitadelMiddleware(options: ZitadelMiddlewareOptions = {}): EventHandler {
  const {
    projectId = PROCESS_ENV.ZITADEL_PROJECT_ID || PROCESS_ENV.NUXT_PUBLIC_ZITADEL_PROJECT_ID,
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
  if (!loginPath.startsWith("/") || loginPath.startsWith("//") || loginPath.includes("\\")) {
    throw new Error(
      `[zitadel] loginPath must be a relative path starting with a single "/". ` +
        `Received: "${loginPath}". Using an absolute or protocol-relative URL ` +
        `would allow open-redirect attacks.`,
    );
  }

  return defineEventHandler(async (event: H3Event) => {
    // Clients never send x-zitadel-auth-token: it is an internal channel. Refuse any
    // request that carries it, on every route, before anything else runs.
    if (getRequestHeader(event, "x-zitadel-auth-token") !== undefined) {
      return sendWebResponse(event, new Response("Bad Request", { status: 400 }));
    }

    const urlObj = getRequestURL(event);
    const { pathname } = urlObj;

    if (matchesRoutes(pathname, ignoredRoutes)) {
      return;
    }

    const route = proxyRoute(pathname, { proxyPath, projectId, loginPath });
    // An OAuth issuer that is not this app's project: the app answers, so its
    // origin never serves another project's issuer.
    if (route?.refused) {
      return sendWebResponse(event, refusedProxyResponse());
    }
    if (route) {
      return proxyRequest(
        event,
        url,
        route,
        urlObj,
        projectId,
        proxyTimeoutMs,
        options.projectSecret,
      );
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
 * Forwards a request that the proxy handles to the backend and streams the response back.
 *
 * The response keeps its `Set-Cookie` headers. Hop-by-hop headers are stripped in both directions,
 * and the session cookie travels under this project's name in the browser and under the server's
 * name upstream ({@link proxySessionCookies}). A redirect from the backend is passed on to the
 * browser, never followed, and the response headers are filtered against the app's own origin. The body is read through the web
 * `Request`, because `Buffer` is not available on every runtime.
 *
 * The project secret is sent as a bearer only on the session-exchange call, which needs it, and
 * only when the caller sent no `Authorization` header of its own. The public proxy therefore never
 * relays operator-capable calls on the server's behalf.
 *
 * @param event - The current H3 event.
 * @param authUrl - The base URL of the backend.
 * @param route - Where the request goes ({@link proxyRoute}).
 * @param url - The parsed request URL.
 * @param projectId - The project this app signs its users in to.
 * @param proxyTimeoutMs - How long the upstream request may take, in milliseconds, before it is
 *   aborted.
 * @param projectSecretOption - The `projectSecret` option, which wins over the runtime config and
 *   the environment, or `undefined` when none is set.
 * @returns The upstream response body stream.
 */
async function proxyRequest(
  event: H3Event,
  authUrl: string,
  route: ProxyRoute,
  url: URL,
  projectId: string | undefined,
  proxyTimeoutMs: number,
  projectSecretOption: string | undefined,
): Promise<ReadableStream<Uint8Array> | null> {
  const suffix = route.path;
  const target = `${joinURL(authUrl, suffix)}${url.search}`;

  const method = getMethod(event);
  const hasBody = !["GET", "HEAD"].includes(method);
  // Read through the web Request, as `Buffer` is not there on every runtime.
  const rawBody = hasBody ? await toWebRequest(event).arrayBuffer() : undefined;
  const body =
    rawBody !== undefined && rawBody.byteLength > 0 ? new Uint8Array(rawBody) : undefined;

  const upstreamHeaders = buildUpstreamHeaders(event);
  for (const [name, value] of Object.entries(route.headers)) {
    upstreamHeaders.set(name, value);
  }
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
    const projectSecret = resolveProjectSecret(config.zitadel, projectSecretOption);
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
    if (key.toLowerCase() === "set-cookie") {
      continue;
    }
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
 * The options {@link handleAuth} takes after the public {@link ZitadelMiddlewareOptions} is
 * destructured.
 *
 * It holds the route policy, plus what the shared {@link resolveSession} judges the session by.
 */
interface AuthHandlerOptions extends ResolveSessionOptions {
  readonly protectedRoutes: readonly string[];
  readonly loginPath: string;
  readonly pathname: string;
}

/**
 * Judges the session, stores the result on the event and applies the route policy.
 *
 * It writes the auth result to `event.context`, sets the session cookies the judgement asks for,
 * and redirects to the login page on a protected route when nobody is signed in. When the backend
 * cannot say whether the session is live, a protected route answers `503` instead.
 *
 * @param event - The current H3 event.
 * @param opts - The auth handler options.
 * @returns The body of a response this handler answers itself, or `undefined` to let the request
 *   continue.
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

  event.context.zitadelAuth = auth;

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
 * Reads the verified session of a request in a server route or API handler.
 *
 * Call it after the middleware has run, which the module arranges for every request that is not
 * on an ignored route. Unlike `useAuth()`, the result includes the raw token, so use it when the
 * token is needed to call an upstream API on the visitor's behalf. Never forward it to the
 * browser.
 *
 * Naming: Takes the framework's own request event or context and returns the verified result
 * that the handler stored on it. It reads and never creates, so it is called getAuth, and it is
 * synchronous because the framework has already handed over the event.
 *
 * @param event - The current H3 event.
 * @returns The current {@link AuthResult}. It is signed out, with a `null` session, when the
 *   middleware did not run for the request or nobody is signed in.
 *
 * @example
 * ```ts
 * import { getAuth } from "@zitadel/sdk-nuxt/server";
 *
 * export default defineEventHandler((event) => {
 *   const auth = getAuth(event);
 *   if (!auth.isAuthenticated) {
 *     throw createError({ statusCode: 401 });
 *   }
 *   return { userId: auth.session.userId };
 * });
 * ```
 */
export function getAuth(event: H3Event): AuthResult {
  return event.context.zitadelAuth ?? { isAuthenticated: false, session: null };
}
