import type { AuthResult, NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import {
  HOP_BY_HOP,
  INTERNAL_HEADERS,
  filterResponseHeaders,
  matchesRoutes,
} from "@zitadel/sdk-core/middleware";

import { verifyJwt, base64UrlDecode } from "./lib/jwt";

/**
 * The decision produced by {@link handleNextgenRequest}: either a ready-to-send
 * `Response` (proxy or login redirect) or an instruction to continue the request
 * with the resolved {@link AuthResult} attached to the router context.
 */
export type NextgenRequestDecision =
  | { readonly type: "proxy"; readonly response: Response }
  | { readonly type: "redirect"; readonly response: Response }
  | { readonly type: "continue"; readonly auth: AuthResult };

/** Options accepted by {@link handleNextgenRequest} and the middleware factory. */
export type NextgenRequestOptions = NextgenMiddlewareOptions & {
  /** Project service-key forwarded as the bearer on proxied requests. */
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
          email: payload.email ?? null,
          name: payload.name ?? null,
          token,
        },
      },
    };
  }

  if (!payload && cookieToken && !isJwtShaped(cookieToken)) {
    const opaqueResult = await validateOpaqueSessionToken(cookieToken, url, opaqueTokenTimeoutMs);
    if (opaqueResult) {
      return {
        type: "continue",
        auth: {
          isAuthenticated: true,
          session: {
            userId: opaqueResult.userId ?? "unknown",
            email: null,
            name: null,
            token: cookieToken,
          },
        },
      };
    }
  }

  if (matchesRoutes(pathname, protectedRoutes)) {
    const loginUrl = new URL(loginPath, url2);
    loginUrl.searchParams.set("next", pathname);
    const headers = new Headers({ location: loginUrl.toString() });
    for (const name of cookies.keys()) {
      if (name.startsWith("__nextgen")) {
        headers.append("set-cookie", clearCookie(name));
      }
    }
    return { type: "redirect", response: new Response(null, { status: 302, headers }) };
  }

  return { type: "continue", auth: { isAuthenticated: false, session: null } };
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
 * verifies the session JWT, and protects routes. Wire it into a global request
 * middleware:
 *
 * ```ts
 * import { createMiddleware, registerGlobalMiddleware } from "@tanstack/react-start";
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
 * registerGlobalMiddleware({ middleware: [authMiddleware] });
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
      return result.response;
    }
    return decision.response;
  };
}

/**
 * Reads the auth state from the TanStack Start router context populated by
 * {@link createNextgenRequestMiddleware}. Pass the `context` available in a
 * server function or `beforeLoad`.
 *
 * @param context - The router/middleware context.
 * @returns The current {@link AuthResult}.
 */
export function getAuth(context: { readonly nextgenAuth?: AuthResult }): AuthResult {
  return context.nextgenAuth ?? { isAuthenticated: false, session: null };
}
