import type { AuthResult, NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import {
  HOP_BY_HOP,
  INTERNAL_HEADERS,
  filterResponseHeaders,
  matchesRoutes,
  requiresProjectSecret,
  validateOpaqueSessionToken,
} from "@zitadel/sdk-core/middleware";

import { verifyJwt, base64UrlDecode } from "./lib/jwt";

/**
 * `process` is undefined in some edge/serverless runtimes; read env defensively
 * so omitting `url`/`projectSecret` falls back to the default instead of throwing
 * a ReferenceError.
 */
const PROCESS_ENV: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? process.env : {};

/**
 * The decision produced by {@link handleNextgenRequest}: either a ready-to-send
 * `Response` (proxy or login redirect) or an instruction to continue the request
 * with the resolved {@link AuthResult} attached to the router context.
 */
export type NextgenRequestDecision =
  | { readonly type: "proxy"; readonly response: Response }
  | { readonly type: "redirect"; readonly response: Response }
  | { readonly type: "reject"; readonly response: Response }
  | {
      readonly type: "continue";
      readonly auth: AuthResult;
      /**
       * `Set-Cookie` values the response to this request must carry — the
       * clearing of dead session cookies. Empty or absent when there are none.
       */
      readonly setCookies?: readonly string[];
    };

/** Options accepted by {@link handleNextgenRequest} and the middleware factory. */
export type NextgenRequestOptions = NextgenMiddlewareOptions & {
  /** Project secret, sent as the bearer on the `POST /sessions/exchange` handoff only. */
  readonly projectSecret?: string;
  /** Direct client address appended to the `X-Forwarded-For` chain. */
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

  const clientIp = clientAddress ?? request.headers.get("x-real-ip") ?? undefined;
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

async function proxyRequest(
  request: Request,
  url: URL,
  authUrl: string,
  proxyPath: string,
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

function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0`;
}

/**
 * Framework-agnostic core that proxies, verifies the session JWT, and decides
 * route protection for a single request. The TanStack Start middleware is a thin
 * wrapper over this; the function is pure (a Web `Request` in, a
 * {@link NextgenRequestDecision} out) so it carries the full, independently
 * testable auth contract regardless of TanStack's evolving middleware surface.
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
    url = PROCESS_ENV.ZITADEL_URL ?? "http://localhost:8080",
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
      projectSecret,
      clientAddress,
      proxyTimeoutMs,
    );
    return { type: "proxy", response };
  }

  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieToken = cookies.get("__nextgen_session") ?? null;
  // Bearer token takes explicit precedence over the session cookie.
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
    return {
      type: "continue",
      auth: {
        isAuthenticated: true,
        session: {
          userId: payload.sub,
          identifier: payload.email ?? null,
          identifierProperty: null,
          display: payload.name ?? null,
          token,
        },
      },
    };
  }

  let liveAnonymousSession = false;
  if (!payload && cookieToken && !isJwtShaped(cookieToken)) {
    const opaque = await validateOpaqueSessionToken(cookieToken, url, opaqueTokenTimeoutMs);
    // A session without a user is anonymous: its sign-in has not verified a
    // factor yet. It is not signed in, but it is live — keep its cookie.
    if (opaque?.userId) {
      return {
        type: "continue",
        auth: {
          isAuthenticated: true,
          session: {
            userId: opaque.userId,
            identifier: opaque.identifier,
            identifierProperty: opaque.identifierProperty,
            display: opaque.display,
            token: cookieToken,
          },
        },
      };
    }
    liveAnonymousSession = opaque !== null;
  }

  // Dead credentials are cleared on every unauthenticated response so the
  // browser stops replaying them (each replay costs a backend session check);
  // a live anonymous session's cookie stays, since its sign-in may complete.
  const setCookies = liveAnonymousSession
    ? []
    : [...cookies.keys()].filter((name) => name.startsWith("__nextgen")).map(clearCookie);

  if (matchesRoutes(pathname, protectedRoutes)) {
    const loginUrl = new URL(loginPath, url2);
    loginUrl.searchParams.set("next", pathname);
    const headers = new Headers({ location: loginUrl.toString() });
    for (const cookie of setCookies) {
      headers.append("set-cookie", cookie);
    }
    return { type: "redirect", response: new Response(null, { status: 302, headers }) };
  }

  return {
    type: "continue",
    auth: { isAuthenticated: false, session: null },
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
    const clientAddress = options.clientAddress ?? request.headers.get("x-real-ip") ?? undefined;
    const decision = await handleNextgenRequest(request, { ...options, clientAddress });

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
