import type { RequestEvent } from "@sveltejs/kit";
import type {
  ZitadelAuthResult,
  ZitadelMiddlewareOptions,
  ZitadelProxyRoute,
  ZitadelResolveSessionOptions,
} from "@zitadel/sdk-core/middleware";
import { joinURL } from "ufo";

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

/**
 * The process environment, or an empty record where there is no `process`.
 *
 * Some edge and serverless runtimes define no `process`. Reading the environment defensively
 * means that leaving out `url` or `projectSecret` falls back to the default instead of throwing
 * a `ReferenceError`.
 */
const PROCESS_ENV: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? process.env : {};

/**
 * The type of the SvelteKit `handle` hook that {@link createZitadelHandle} returns.
 *
 * The type is declared structurally from `RequestEvent` instead of importing `Handle`. SvelteKit 2
 * exports `Handle` from `@sveltejs/kit`, but SvelteKit 3 declares it only under
 * `@sveltejs/kit/hooks`, so importing it from the main entry would silently type the hook as
 * `any` on SvelteKit 3. `RequestEvent` is exported from `@sveltejs/kit` on both majors, and this
 * shape is assignable to either `Handle`, because it accepts a `resolve` that takes no options
 * argument and the hook never passes one.
 *
 * Use it to type a hook that you compose with {@link createZitadelHandle} through
 * `sequence()` from `@sveltejs/kit/hooks`. The hook returns a `Promise` of a `Response` and
 * always receives the request event and the downstream `resolve` function.
 *
 * @example
 * ```ts
 * import type { ZitadelHandle } from "@zitadel/sdk-sveltekit/server";
 *
 * export const logRequests: ZitadelHandle = async ({ event, resolve }) => {
 *   console.log(event.request.method, event.url.pathname);
 *   return resolve(event);
 * };
 * ```
 */
export type ZitadelHandle = (input: {
  event: RequestEvent;
  resolve: (event: RequestEvent) => Promise<Response> | Response;
}) => Promise<Response>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace App {
    /**
     * The shape of `event.locals`, which SvelteKit reads to type the request locals.
     *
     * Declaring the interface here merges {@link Locals.zitadelAuth} into your own `App.Locals`
     * from `src/app.d.ts`, so {@link getAuth} and load functions see the typed auth result without
     * any manual wiring.
     */
    interface Locals {
      /**
       * The verified auth result of the current request.
       *
       * The hook from {@link createZitadelHandle} writes it on every request that is neither
       * proxied nor ignored. It is `undefined` before the hook has run and on routes listed in
       * {@link ZitadelMiddlewareOptions.ignoredRoutes}. Read it through {@link getAuth}, which
       * turns the missing case into a signed-out result.
       */
      zitadelAuth?: ZitadelAuthResult;
    }
  }
}

/**
 * Builds the request headers that the proxy sends to the auth backend.
 *
 * The function copies every incoming header except the hop-by-hop and SDK-internal ones, then
 * sets the `x-forwarded-*` headers so the backend can see the real client origin. A
 * `x-forwarded-for` chain that a CDN or load balancer already set is kept, and the direct client
 * address from `event.getClientAddress()` is appended to it, so the backend sees the full proxy
 * path. When no chain exists, the chain starts with that address. When the platform adapter
 * cannot resolve a client address, the chain is left as received and the proxy does not fail.
 * `x-forwarded-host` and `x-forwarded-proto` are set only when absent, which preserves the values
 * that an upstream CDN injected.
 *
 * @param event - The current SvelteKit request event.
 * @returns A `Headers` instance that is safe to forward to the backend.
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
 * Forwards a request under the proxy path to the auth backend and returns the backend response.
 *
 * The proxy exists so the browser only ever talks to the app's own origin. The response keeps its
 * `set-cookie` headers. Hop-by-hop headers are stripped in both directions, a `location` header
 * is kept only as a redirect onto this app, and the session cookie travels under this project's
 * own name in the browser and under the server's name upstream. The request body is read into a
 * buffer first, because a streaming body would need the `duplex` option, which platform adapters
 * do not support uniformly. The redirect mode is `manual`, so a backend redirect reaches the
 * browser instead of being followed on the server. The project secret is attached as the bearer
 * on the `POST /sessions/exchange` handoff alone, because on every operation it would turn this
 * public boundary into an open relay with project authority. A credential that the caller
 * supplied is preserved. A response that sets a session cookie is marked as not cacheable by a
 * shared cache.
 *
 * @param event - The current SvelteKit request event.
 * @param authUrl - The base URL of the auth backend.
 * @param route - Where the request goes ({@link proxyRoute}).
 * @param projectId - The project id this app signs its users in to.
 * @param projectSecret - The project secret, or `undefined` when none is configured.
 * @param proxyTimeoutMs - The time in milliseconds after which the backend request is aborted.
 * @returns The proxied backend `Response`.
 * @throws Error when the backend does not answer within `proxyTimeoutMs` or cannot be reached.
 */
async function proxyRequest(
  event: RequestEvent,
  authUrl: string,
  route: ZitadelProxyRoute,
  projectId: string | undefined,
  projectSecret: string | undefined,
  proxyTimeoutMs: number,
): Promise<Response> {
  const { url } = event;
  const suffix = route.path;
  const target = `${joinURL(authUrl, suffix)}${url.search}`;

  const method = event.request.method;
  const hasBody = !["GET", "HEAD"].includes(method);
  // Read the body eagerly so the upstream fetch receives a concrete buffer
  // rather than a streaming body (which would require the `duplex` option and
  // is not supported uniformly across platform adapters).
  const buffered = hasBody ? await event.request.arrayBuffer() : undefined;
  const body = buffered && buffered.byteLength > 0 ? buffered : undefined;

  const upstreamHeaders = buildUpstreamHeaders(event);
  for (const [name, value] of Object.entries(route.headers)) {
    upstreamHeaders.set(name, value);
  }
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
    requiresProjectSecret(method, suffix, upstreamHeaders) &&
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
 * The options that {@link createZitadelHandle} passes to the auth step.
 *
 * They are the route policy plus what the shared session resolver judges the session by, taken
 * from the public {@link ZitadelMiddlewareOptions} after defaults are applied.
 */
interface AuthHandlerOptions extends ZitadelResolveSessionOptions {
  /**
   * The route patterns that require a session.
   */
  readonly protectedRoutes: readonly string[];
  /**
   * The relative path that a signed-out visitor to a protected route is redirected to.
   */
  readonly loginPath: string;
}

/**
 * Verifies the session, records the result, and either continues the request or redirects.
 *
 * The function writes the auth result to `event.locals.zitadelAuth`, then continues the request
 * through `resolve`, or redirects to the login page with status `302` on a protected route that
 * has no valid session. Either way the response carries the session cookies that the verdict asks
 * for. When the backend cannot say whether the session is live, a protected route answers `503`
 * instead of redirecting, because the user may well be signed in.
 *
 * A cookie of a dead session is cleared so the browser stops replaying it, and a session of this
 * project that is still under the shared cookie name is copied to the project's own cookie. A
 * live session that signs no one in here, such as an anonymous one whose sign-in may still
 * complete or one of another project, keeps its cookie, and so does a session the backend gave no
 * verdict on. Cookie attributes are always given in full, because when one is left out SvelteKit
 * adds `Secure` on its own, which Safari drops over plain http to `127.0.0.1` and `[::1]`.
 * Responses that set a session cookie are marked as not cacheable by a shared cache.
 *
 * @param event - The current SvelteKit request event.
 * @param resolve - The downstream resolver from the `handle` hook.
 * @param opts - The route policy and the session verification options.
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

  event.locals.zitadelAuth = auth;

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
 * Marks a response as not cacheable by a shared cache.
 *
 * The header is set on the response and not through `event.setHeaders`, which fails the request
 * when a page sets the same header too. A response whose headers are immutable is copied first,
 * so the caller always receives a response that carries the header.
 *
 * @param response - The response to mark.
 * @returns The same response, or a copy of it when its headers are immutable.
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
 * Creates the SvelteKit `handle` hook that proxies the auth backend, verifies sessions and
 * protects routes.
 *
 * The hook is the server half of Zitadel sign-in. It exists so the browser only ever talks to
 * your own origin, so the project secret never leaves the server, and so every page request knows
 * whether the visitor is signed in. Create it once per app in `src/hooks.server.ts` and compose it
 * with your own hooks through `sequence()` from `@sveltejs/kit/hooks`.
 *
 * For each request the hook, in order:
 *
 * 1. answers `400` to any request that carries `x-zitadel-auth-token`. The header is an internal
 *    channel that only the SDK writes after verifying a session, so a client has no reason to send
 *    it, and refusing it outright is safer than removing it, because no framework's header
 *    mutability matters then. The check covers every route, including ignored routes and the
 *    proxy path;
 * 2. passes requests that match {@link ZitadelMiddlewareOptions.ignoredRoutes} straight to
 *    `resolve`, without proxying, verification or `event.locals.zitadelAuth`;
 * 3. proxies requests under {@link ZitadelMiddlewareOptions.proxyPath} to
 *    {@link ZitadelMiddlewareOptions.url}, so the browser talks to the auth backend same-origin.
 *    The project secret is attached as the bearer on the `POST /sessions/exchange` handoff alone
 *    and never reaches the browser;
 * 4. verifies the session token against the server's JWKS with Web Crypto, or asks the backend
 *    about an opaque token, and stores the result in `event.locals.zitadelAuth`. On a protected
 *    route with no session it redirects to {@link ZitadelMiddlewareOptions.loginPath} with the
 *    requested path in `?next=`, so the user returns there after signing in. When the backend
 *    cannot say whether the session is live, a protected route answers `503` instead of sending a
 *    possibly signed-in user to the login page.
 *
 * A session counts only in the app's own project, so a session of another project on the same
 * host does not sign anyone in. Protection covers full page loads only: client-side navigation
 * does not reach the hook, so guard such pages with a load function that calls {@link getAuth}.
 *
 * Settings that are left out fall back to the environment. SvelteKit never fills `process.env`
 * from `.env` files, so read the values from `$app/env/private` and pass them in, as in the
 * example. An empty value counts as unset. The fallbacks are `ZITADEL_URL` for `url` (then
 * `http://localhost:8080`), `ZITADEL_PROJECT_SECRET` for `projectSecret`, and `ZITADEL_PROJECT_ID`
 * and then `VITE_ZITADEL_PROJECT_ID` for `projectId`. Without a `projectSecret` the session
 * handoff cannot be exchanged. The values are read once, when the hook is created, so they do not
 * change afterwards.
 *
 * The hook uses only Web APIs, which are `fetch`, Web Crypto and `AbortSignal.timeout`, and reads
 * `process.env` only when `process` exists. It therefore runs on Cloudflare Workers and other
 * edge adapters.
 *
 * Naming: SvelteKit calls this hook handle: it is the handle export of hooks.server.ts and is
 * composed with sequence(), so the name ends in Handle and the call reads export const handle =
 * createZitadelHandle(...). It is a factory, called once to return the hook, so it starts with
 * create.
 *
 * A signed-out request for a protected route is redirected with an absolute URL on the origin of
 * the request, such as `https://app.example.com/login?next=%2Fadmin`.
 *
 * The proxy forwards a client's `x-forwarded-host` and `x-forwarded-proto` unchanged and sets them
 * from the request only when the client sent none. It cannot tell a trusted CDN or load balancer
 * from a client, and the server builds the OAuth issuer and the `Secure` decision for session
 * cookies from those headers, so strip them at the edge when clients can reach the app directly.
 *
 * @param options - The middleware settings, which are all optional. `projectSecret` is the
 *   project service key, sent as the bearer on the `POST /sessions/exchange` handoff only.
 * @returns A SvelteKit `handle` hook of type {@link ZitadelHandle}.
 * @throws Error when `loginPath` is not a relative path that starts with a single `/`, because an
 *   absolute or protocol-relative URL would let the login redirect leave the app, which is an
 *   open redirect.
 * @example
 * ```ts
 * import { ZITADEL_PROJECT_ID, ZITADEL_PROJECT_SECRET, ZITADEL_URL } from "$app/env/private";
 * import { createZitadelHandle } from "@zitadel/sdk-sveltekit/server";
 *
 * export const handle = createZitadelHandle({
 *   url: ZITADEL_URL,
 *   projectSecret: ZITADEL_PROJECT_SECRET,
 *   projectId: ZITADEL_PROJECT_ID,
 *   protectedRoutes: ["/admin*", "/dashboard*"],
 *   loginPath: "/login",
 * });
 * ```
 * @example
 * ```ts
 * import { sequence } from "@sveltejs/kit/hooks";
 * import { createZitadelHandle } from "@zitadel/sdk-sveltekit/server";
 *
 * export const handle = sequence(createZitadelHandle({ protectedRoutes: ["/admin*"] }), myHook);
 * ```
 * @see {@link getAuth}
 */
export function createZitadelHandle(options: ZitadelMiddlewareOptions = {}): ZitadelHandle {
  const {
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
  } = options;
  const url = options.url || PROCESS_ENV.ZITADEL_URL || "http://localhost:8080";
  const projectSecret = options.projectSecret || PROCESS_ENV.ZITADEL_PROJECT_SECRET;

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

  return async ({ event, resolve }) => {
    const { pathname } = event.url;

    // Clients never send x-zitadel-auth-token: it is an internal channel. Refuse any
    // request that carries it, on every route, before anything else runs.
    if (event.request.headers.has("x-zitadel-auth-token")) {
      return new Response("Bad Request", { status: 400 });
    }

    if (matchesRoutes(pathname, ignoredRoutes)) {
      return resolve(event);
    }

    const route = proxyRoute(pathname, { proxyPath, projectId, loginPath });
    // An OAuth issuer that is not this app's project: the app answers, so its
    // origin never serves another project's issuer.
    if (route?.refused) {
      return refusedProxyResponse();
    }
    if (route) {
      return proxyRequest(event, url, route, projectId, projectSecret, proxyTimeoutMs);
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
 * Reads the auth state of a request inside a load function, endpoint or action.
 *
 * Call it after the hook from {@link createZitadelHandle} has run. The function only reads
 * `event.locals.zitadelAuth`, so it performs no verification and no network call. When the hook
 * has not written a result, for example on a route in
 * {@link ZitadelMiddlewareOptions.ignoredRoutes}, the function returns a signed-out result
 * instead of `undefined`. The result carries the session token, so keep it on the server: return
 * only the fields you need from a load function, because load data is serialized into the page.
 * Client-side navigation does not reach the hook, so a page that must stay protected calls this
 * function in its own load function.
 *
 * Naming: Takes the framework's own request event or context and returns the verified result
 * that the handler stored on it. It reads and never creates, so it is called getAuth, and it is
 * synchronous because the framework has already handed over the event.
 *
 * @param event - The current SvelteKit request event.
 * @returns The current {@link ZitadelAuthResult}: signed in with a session, or signed out with a `null`
 *   session.
 * @example
 * ```ts
 * import { redirect } from "@sveltejs/kit";
 * import { getAuth } from "@zitadel/sdk-sveltekit/server";
 *
 * export const load = (event) => {
 *   const auth = getAuth(event);
 *   if (!auth.isAuthenticated) {
 *     throw redirect(302, "/login");
 *   }
 *   return { userId: auth.session.userId };
 * };
 * ```
 * @see {@link createZitadelHandle}
 */
export function getAuth(event: RequestEvent): ZitadelAuthResult {
  return event.locals.zitadelAuth ?? { isAuthenticated: false, session: null };
}
