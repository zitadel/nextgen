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
  requiresProjectSecret,
  resolveSession,
} from "@zitadel/sdk-core/middleware";

/**
 * `process` is undefined in some edge/serverless runtimes; read env defensively
 * so the `process.env` fallback never throws a ReferenceError (Qwik City's
 * `ev.env` is the primary source).
 */
const PROCESS_ENV: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? process.env : {};

/**
 * The slice of Qwik Router's `RequestEvent` this handler reads. `@qwik.dev/router`
 * is a peer, not a runtime dependency: typing only the handful of fields we
 * touch keeps the built output free of a Qwik import, the same way `sdk-nuxt`
 * shims Nuxt's `#imports`. The shape is structurally compatible with the real
 * `RequestEvent` (a type-level test asserts it), so the returned handler drops
 * straight into `export const onRequest = createNextgenOnRequest(...)`.
 */
export interface QwikCookieValue {
  readonly value: string;
}

export interface QwikRequestEvent {
  readonly request: Request;
  readonly url: URL;
  readonly sharedMap: Map<string, unknown>;
  readonly clientConn: { readonly ip?: string };
  readonly cookie: {
    get(name: string): QwikCookieValue | null;
    getAll(): Record<string, QwikCookieValue>;
    delete(name: string, options?: { path?: string }): void;
  };
  /** Sends a custom response and ends the chain. */
  send(response: Response): void;
  /** Returns a redirect marker to be thrown. */
  redirect(statusCode: number, url: string): unknown;
  /**
   * Qwik City's platform env getter. This is how server env reaches the
   * handler: Vite/Qwik load `.env`/`.env.local` into `ev.env`, NOT into
   * `process.env`, so `ZITADEL_URL` / `ZITADEL_PROJECT_SECRET` are read here
   * (mirroring SvelteKit's `$env/dynamic/private`). Optional so unit-test mocks
   * that exercise only the auth path need not stub it.
   */
  readonly env?: { get(key: string): string | undefined };
}

/** Parses a `Cookie` request header into a name→value map. */
function parseCookieHeader(header: string | null): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) jar.set(name, value);
  }
  return jar;
}

/**
 * Builds the upstream request headers: copies all incoming headers, drops
 * hop-by-hop and SDK-internal headers, and sets `X-Forwarded-*` so the auth
 * server sees the real client origin. The client IP comes from
 * `ev.clientConn.ip` (or any existing `X-Forwarded-For` chain).
 */
function buildUpstreamHeaders(ev: QwikRequestEvent): Headers {
  const headers = new Headers();
  for (const [key, value] of ev.request.headers) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || INTERNAL_HEADERS.has(lower)) {
      continue;
    }
    headers.set(key, value);
  }

  const clientIp = ev.clientConn.ip;
  if (clientIp) {
    const existingXff = headers.get("x-forwarded-for");
    headers.set("x-forwarded-for", existingXff ? `${existingXff}, ${clientIp}` : clientIp);
  }

  if (!headers.has("x-forwarded-host")) {
    headers.set("x-forwarded-host", ev.url.host);
  }

  if (!headers.has("x-forwarded-proto")) {
    headers.set("x-forwarded-proto", ev.url.protocol.replace(":", ""));
  }

  return headers;
}

/**
 * Forwards a `/__nextgen/*` request to the upstream auth backend and returns the
 * upstream response verbatim, including `Set-Cookie` headers. Hop-by-hop
 * headers are stripped in both directions, and a `location` is kept only as a
 * redirect onto this app.
 */
async function proxyResponse(
  ev: QwikRequestEvent,
  authUrl: string,
  proxyPath: string,
  projectSecret: string | undefined,
  proxyTimeoutMs: number,
): Promise<Response> {
  const suffix = ev.url.pathname.slice(proxyPath.length);
  const target = `${authUrl}${suffix}${ev.url.search}`;

  const method = ev.request.method;
  const hasBody = !["GET", "HEAD"].includes(method);
  const body = hasBody ? await ev.request.arrayBuffer() : undefined;

  const upstreamHeaders = buildUpstreamHeaders(ev);

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
  const responseHeaders = filterResponseHeaders(upstream.headers, ev.url.toString());
  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

/** Key under which the auth result is stored on `ev.sharedMap`. */
const SHARED_MAP_KEY = "nextgenAuth";

/**
 * The route policy, plus what the shared {@link resolveSession} judges the
 * session by.
 */
interface AuthHandlerOptions extends ResolveSessionOptions {
  readonly protectedRoutes: readonly string[];
  readonly loginPath: string;
}

/**
 * Judges the session and writes the auth result to `ev.sharedMap`. Clears
 * `__nextgen*` cookies that hold dead credentials, and on a protected route
 * with nobody signed in throws `ev.redirect(...)` to send the browser to the
 * login page. When the backend cannot say whether the session is live, the
 * cookies stay and a protected route answers `503`.
 */
async function handleAuth(ev: QwikRequestEvent, opts: AuthHandlerOptions): Promise<void> {
  const { protectedRoutes, loginPath, ...verification } = opts;
  const { pathname } = ev.url;

  const cookies = parseCookieHeader(ev.request.headers.get("cookie"));
  const authHeader = ev.request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieToken =
    ev.cookie.get("__nextgen_session")?.value ?? cookies.get("__nextgen_session") ?? null;
  const { auth, clearCookies, undecided } = await resolveSession(
    { bearer: bearerToken, cookie: cookieToken },
    verification,
  );

  ev.sharedMap.set(SHARED_MAP_KEY, auth);
  if (auth.isAuthenticated) {
    return;
  }

  // The backend could not say whether the session is live. The user may well
  // be signed in, so a protected route answers 503 rather than send them to
  // the login page.
  if (undecided && matchesRoutes(pathname, protectedRoutes)) {
    ev.send(new Response("Service Unavailable", { status: 503 }));
    return;
  }

  // Dead credentials are cleared on every unauthenticated response so the
  // browser stops replaying them (each replay costs a backend session check).
  // A live session that signs no one in here (an anonymous one, whose sign-in
  // may still complete, or one of another project) keeps its cookie, and so
  // does one the backend gave no verdict on. Qwik applies the deletion to
  // whichever response goes out.
  if (clearCookies) {
    for (const name of Object.keys(ev.cookie.getAll())) {
      if (name.startsWith("__nextgen")) {
        ev.cookie.delete(name, { path: "/" });
      }
    }
  }

  if (matchesRoutes(pathname, protectedRoutes)) {
    const loginUrl = loginRedirectUrl(loginPath, ev.url);
    throw ev.redirect(302, `${loginUrl.pathname}${loginUrl.search}`);
  }
}

/**
 * Creates a Qwik City `RequestHandler` that handles proxying, JWT verification,
 * and route protection in a single `onRequest` pass.
 *
 * Place it in a layout or root plugin, e.g. `src/routes/plugin@nextgen.ts`:
 *
 * ```ts
 * import { createNextgenOnRequest } from "@zitadel/sdk-qwik-city/server";
 *
 * export const onRequest = createNextgenOnRequest({
 *   protectedRoutes: ["/admin*", "/dashboard*"],
 *   loginPath: "/login",
 * });
 * ```
 *
 * `url` and `projectSecret` default to `ZITADEL_URL` / `ZITADEL_PROJECT_SECRET`,
 * read per request from `ev.env` (where Vite loads `.env.local`), then
 * `process.env`. A session counts only in the app's own project: `projectId`,
 * else `ZITADEL_PROJECT_ID`, else `PUBLIC_ZITADEL_PROJECT_ID`, read the same way.
 *
 * @param options - Configuration. `projectSecret` is the project service-key
 *   sent as the bearer on the `POST /sessions/exchange` handoff only.
 * @returns A Qwik City `RequestHandler`.
 */
export function createNextgenOnRequest(
  options: NextgenMiddlewareOptions & { projectSecret?: string } = {},
): (ev: QwikRequestEvent) => Promise<void> {
  const {
    url: urlOption,
    projectId: projectIdOption,
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
    projectSecret: projectSecretOption,
  } = options;

  // Guard against open-redirect: loginPath must be a relative path.
  if (!loginPath.startsWith("/") || loginPath.startsWith("//")) {
    throw new Error(
      `[nextgen] loginPath must be a relative path starting with a single "/". ` +
        `Received: "${loginPath}". Using an absolute or protocol-relative URL ` +
        `would allow open-redirect attacks.`,
    );
  }

  return async (ev: QwikRequestEvent): Promise<void> => {
    const { pathname } = ev.url;

    // Clients never send x-nextgen-auth-token: it is an internal channel. Refuse any
    // request that carries it, on every route, before anything else runs.
    if (ev.request.headers.has("x-nextgen-auth-token")) {
      ev.send(new Response("Bad Request", { status: 400 }));
      return;
    }

    // Resolve the backend URL and project secret per request. Precedence:
    // explicit option > Qwik City's `ev.env` (which carries `.env.local`) >
    // `process.env` (set in production adapters) > localhost default. Qwik does
    // not surface `.env` files on `process.env`, so a factory-time read would
    // miss them and the proxy would fall back to :8080 ("fetch failed").
    const url =
      urlOption ?? ev.env?.get("ZITADEL_URL") ?? PROCESS_ENV.ZITADEL_URL ?? "http://localhost:8080";
    const projectSecret =
      projectSecretOption ??
      ev.env?.get("ZITADEL_PROJECT_SECRET") ??
      PROCESS_ENV.ZITADEL_PROJECT_SECRET;
    const projectId =
      projectIdOption ??
      (ev.env?.get("ZITADEL_PROJECT_ID") ||
        ev.env?.get("PUBLIC_ZITADEL_PROJECT_ID") ||
        PROCESS_ENV.ZITADEL_PROJECT_ID ||
        PROCESS_ENV.PUBLIC_ZITADEL_PROJECT_ID);

    if (matchesRoutes(pathname, ignoredRoutes)) {
      return;
    }

    if (pathname === proxyPath || pathname.startsWith(`${proxyPath}/`)) {
      ev.send(await proxyResponse(ev, url, proxyPath, projectSecret, proxyTimeoutMs));
      return;
    }

    await handleAuth(ev, {
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
 * Reads the auth state from a Qwik City request event after the handler has run.
 * Call it inside a `routeLoader$`, `routeAction$`, or endpoint:
 *
 * ```ts
 * import { getAuth } from "@zitadel/sdk-qwik-city/server";
 *
 * export const useUser = routeLoader$((ev) => {
 *   const auth = getAuth(ev);
 *   if (!auth.isAuthenticated) throw ev.redirect(302, "/login");
 *   return auth.session.userId;
 * });
 * ```
 *
 * @param ev - The current Qwik City request event.
 * @returns The current {@link AuthResult}.
 */
export function getAuth(ev: { sharedMap: Map<string, unknown> }): AuthResult {
  return (
    (ev.sharedMap.get(SHARED_MAP_KEY) as AuthResult | undefined) ?? {
      isAuthenticated: false,
      session: null,
    }
  );
}
