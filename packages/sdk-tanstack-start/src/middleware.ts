import type { AuthResult, NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import {
  HOP_BY_HOP,
  INTERNAL_HEADERS,
  filterResponseHeaders,
  loginRedirectUrl,
  matchesRoutes,
  normalizeBackendUrl,
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
 * The decision produced by {@link handleNextgenRequest}: either a ready-to-send
 * `Response` (proxy, login redirect, or a refusal: `400` for a request carrying
 * the internal auth header, `503` for a protected route whose session the
 * backend could not check) or an instruction to continue the request with the
 * resolved {@link AuthResult} attached to the router context.
 */
export type NextgenRequestDecision =
  | { readonly type: "proxy"; readonly response: Response }
  | { readonly type: "redirect"; readonly response: Response }
  | { readonly type: "reject"; readonly response: Response }
  | {
      readonly type: "continue";
      readonly auth: AuthResult;
      /**
       * `Set-Cookie` values the response to this request must carry: a dead
       * session cookie cleared, or a session of this project copied out of the
       * shared cookie into the project's own. Empty or absent when there are
       * none. A response that carries them also sends
       * `Cache-Control: private, no-store`, so no shared cache keeps them.
       */
      readonly setCookies?: readonly string[];
    };

/** Options accepted by {@link handleNextgenRequest} and the middleware factory. */
export type NextgenRequestOptions = NextgenMiddlewareOptions & {
  /** Project secret, sent as the bearer on the `POST /sessions/exchange` handoff only. */
  readonly projectSecret?: string;
  /**
   * Direct client address appended to the `X-Forwarded-For` chain. Supply the
   * address your server runtime provides; a request header is never used.
   */
  readonly clientAddress?: string;
};

function buildUpstreamHeaders(
  request: Request,
  url: URL,
  clientAddress: string | undefined,
): Headers {
  const headers = new Headers();
  for (const [key, value] of request.headers) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || INTERNAL_HEADERS.has(lower)) {
      continue;
    }
    headers.set(key, value);
  }

  const clientIp = clientAddress;
  if (clientIp) {
    const existingXff = headers.get("x-forwarded-for");
    headers.set("x-forwarded-for", existingXff ? `${existingXff}, ${clientIp}` : clientIp);
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
 * Forwards a `/__nextgen/*` request to the upstream auth backend. The session
 * cookie travels under this project's name in the browser and the server's name
 * upstream ({@link proxySessionCookies}).
 */
async function proxyRequest(
  request: Request,
  url: URL,
  authUrl: string,
  proxyPath: string,
  projectId: string | undefined,
  projectSecret: string | undefined,
  clientAddress: string | undefined,
  proxyTimeoutMs: number,
): Promise<Response> {
  const suffix = url.pathname.slice(proxyPath.length);
  const target = `${authUrl}${suffix}${url.search}`;

  const method = request.method;
  const hasBody = !["GET", "HEAD"].includes(method);
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const upstreamHeaders = buildUpstreamHeaders(request, url, clientAddress);
  const sessionCookies = proxySessionCookies(
    {
      method,
      path: suffix,
      search: url.search,
      cookie: request.headers.get("cookie"),
      requestUrl: url,
      forwardedProto: request.headers.get("x-forwarded-proto"),
      forwardedHost: request.headers.get("x-forwarded-host"),
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
 * Framework-agnostic core that proxies, verifies the session JWT, and decides
 * route protection for a single request. The TanStack Start middleware is a thin
 * wrapper over this; the function is pure (a Web `Request` in, a
 * {@link NextgenRequestDecision} out) so it carries the full, independently
 * testable auth contract regardless of TanStack's evolving middleware surface.
 *
 * A session counts only in the app's own project: `projectId`, else
 * `ZITADEL_PROJECT_ID`, else `VITE_ZITADEL_PROJECT_ID`.
 *
 * @param request - The incoming Web `Request`.
 * @param options - Configuration; `projectSecret` and `clientAddress` augment
 *   the shared {@link NextgenMiddlewareOptions}.
 * @returns A {@link NextgenRequestDecision}.
 */
export async function handleNextgenRequest(
  request: Request,
  options: NextgenRequestOptions = {},
): Promise<NextgenRequestDecision> {
  const {
    url: configuredUrl = PROCESS_ENV.ZITADEL_URL ?? "http://localhost:8080",
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
    clientAddress,
  } = options;
  const url = normalizeBackendUrl(configuredUrl);

  // Guard against open-redirect: loginPath must be a relative path.
  if (!loginPath.startsWith("/") || loginPath.startsWith("//")) {
    throw new Error(
      `[nextgen] loginPath must be a relative path starting with a single "/". ` +
        `Received: "${loginPath}". Using an absolute or protocol-relative URL ` +
        `would allow open-redirect attacks.`,
    );
  }

  const url2 = new URL(request.url);
  const { pathname } = url2;

  // Clients never send x-nextgen-auth-token: it is an internal channel. Refuse any
  // request that carries it, on every route, before anything else runs.
  if (request.headers.has("x-nextgen-auth-token")) {
    return { type: "reject", response: new Response("Bad Request", { status: 400 }) };
  }

  if (matchesRoutes(pathname, ignoredRoutes)) {
    return { type: "continue", auth: { isAuthenticated: false, session: null } };
  }

  if (pathname === proxyPath || pathname.startsWith(`${proxyPath}/`)) {
    const response = await proxyRequest(
      request,
      url2,
      url,
      proxyPath,
      projectId,
      projectSecret,
      clientAddress,
      proxyTimeoutMs,
    );
    return { type: "proxy", response };
  }

  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const {
    auth,
    undecided,
    cookies: sessionCookies,
  } = await resolveSession(
    {
      bearer: bearerToken,
      cookie: (name) => cookies.get(name),
      requestUrl: url2,
      forwardedProto: request.headers.get("x-forwarded-proto"),
      forwardedHost: request.headers.get("x-forwarded-host"),
    },
    {
      url,
      projectId,
      allowedAlgorithms,
      clockSkewMs,
      audience,
      allowedTokenTypes,
      jwksTimeoutMs,
      opaqueTokenTimeoutMs,
    },
  );

  // A dead session's cookie is cleared so the browser stops replaying it (each
  // replay costs a backend session check), and a session of this project still
  // under the shared name is copied to the project's own cookie. A live session
  // that signs no one in here (an anonymous one, whose sign-in may still
  // complete, or one of another project) keeps its cookie, and so does one the
  // backend gave no verdict on.
  const setCookies = sessionCookies.map(serializeSessionCookie);

  // The backend could not say whether the session is live. The user may well
  // be signed in, so a protected route answers 503 rather than send them to
  // the login page.
  if (undecided && matchesRoutes(pathname, protectedRoutes)) {
    return { type: "reject", response: new Response("Service Unavailable", { status: 503 }) };
  }

  if (!auth.isAuthenticated && matchesRoutes(pathname, protectedRoutes)) {
    const headers = new Headers({ location: loginRedirectUrl(loginPath, url2).toString() });
    for (const cookie of setCookies) {
      headers.append("set-cookie", cookie);
    }
    if (setCookies.length > 0) {
      headers.set("cache-control", SESSION_COOKIE_CACHE_CONTROL);
    }
    return { type: "redirect", response: new Response(null, { status: 302, headers }) };
  }

  return {
    type: "continue",
    auth,
    ...(setCookies.length > 0 ? { setCookies } : {}),
  };
}

/**
 * The slice of TanStack Start's request-middleware context this adapter uses.
 * TanStack Start is not a dependency of this package — typing the two fields we
 * touch keeps the install light and resilient to TanStack's evolving server
 * middleware API. The shape is structurally compatible with the real context.
 */
export interface RequestMiddlewareContext {
  readonly request: Request;
  readonly next: (opts?: {
    readonly context?: Record<string, unknown>;
  }) => Promise<{ readonly response: Response }>;
}

/** Key under which the auth result is placed on the router context. */
const CONTEXT_KEY = "nextgenAuth";

/**
 * Creates a TanStack Start request-middleware server handler that proxies,
 * verifies the session JWT, and protects routes. Register it as a global
 * request middleware from the framework server entry, `src/start.ts`:
 *
 * ```ts
 * import { createMiddleware, createStart } from "@tanstack/react-start";
 * import { createNextgenRequestMiddleware } from "@zitadel/sdk-tanstack-start/server";
 *
 * const authMiddleware = createMiddleware({ type: "request" }).server(
 *   createNextgenRequestMiddleware({
 *     url: process.env.ZITADEL_URL,
 *     projectSecret: process.env.ZITADEL_PROJECT_SECRET,
 *     protectedRoutes: ["/admin*"],
 *     loginPath: "/login",
 *   }),
 * );
 *
 * export const startInstance = createStart(() => ({
 *   requestMiddleware: [authMiddleware],
 * }));
 * ```
 *
 * On an authenticated request it calls `next({ context: { nextgenAuth } })` so
 * loaders and server functions can read the session via {@link getAuth}. On a
 * proxy or protected-route miss it returns the `Response` directly.
 *
 * @param options - Configuration; see {@link NextgenRequestOptions}.
 * @returns A request-middleware server handler.
 */
export function createNextgenRequestMiddleware(
  options: NextgenRequestOptions = {},
): (ctx: RequestMiddlewareContext) => Promise<Response> {
  return async ({ request, next }: RequestMiddlewareContext): Promise<Response> => {
    const decision = await handleNextgenRequest(request, options);

    if (decision.type === "continue") {
      const result = await next({ context: { [CONTEXT_KEY]: decision.auth } });
      if (!decision.setCookies?.length) {
        return result.response;
      }
      // A downstream response's headers may be immutable; copy before adding.
      const response = new Response(result.response.body, result.response);
      for (const cookie of decision.setCookies) {
        response.headers.append("set-cookie", cookie);
      }
      response.headers.set("cache-control", SESSION_COOKIE_CACHE_CONTROL);
      return response;
    }
    return decision.response;
  };
}

/**
 * Reads the auth state from the request context populated by
 * {@link createNextgenRequestMiddleware}. Pass the `context` a server function
 * handler receives. A route's `beforeLoad` context does not carry it (TanStack
 * nests request-middleware context under `serverContext`, and on client-side
 * navigation `beforeLoad` runs in the browser) — call a server function from
 * `beforeLoad` instead.
 *
 * @param context - The router/middleware context.
 * @returns The current {@link AuthResult}.
 */
export function getAuth(context: { readonly nextgenAuth?: AuthResult } | undefined): AuthResult {
  return context?.nextgenAuth ?? { isAuthenticated: false, session: null };
}
