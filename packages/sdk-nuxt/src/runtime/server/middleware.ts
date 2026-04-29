import type { H3Event } from "h3";
import {
  defineEventHandler,
  getCookie,
  deleteCookie,
  sendRedirect,
  getRequestURL,
  getRequestHeader,
  readRawBody,
} from "h3";
import type { AuthResult, NextgenModuleOptions } from "../types";

declare module "h3" {
  interface H3EventContext {
    nextgenAuth: AuthResult;
  }
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const jwksCache = new Map<string, { key: CryptoKey; fetchedAt: number }>();
const JWKS_TTL_MS = 5 * 60 * 1000;

interface JwtPayload {
  sub?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  email?: string;
  name?: string;
  [key: string]: unknown;
}

function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf;
}

function decodeJwt(token: string): {
  header: Record<string, unknown>;
  payload: JwtPayload;
} {
  const [h, p] = token.split(".");
  return {
    header: JSON.parse(new TextDecoder().decode(base64UrlDecode(h))) as Record<string, unknown>,
    payload: JSON.parse(new TextDecoder().decode(base64UrlDecode(p))) as JwtPayload,
  };
}

async function fetchAndCacheJwks(jwksUri: string, kid: string | undefined): Promise<CryptoKey | null> {
  if (kid) {
    const cached = jwksCache.get(kid);
    if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.key;
  }

  const res = await fetch(jwksUri);
  const { keys } = (await res.json()) as { keys: (JsonWebKey & { kid?: string; alg?: string })[] };

  let jwk: (JsonWebKey & { kid?: string; alg?: string }) | undefined;
  if (kid) {
    jwk = keys.find((k) => k.kid === kid);
  } else {
    jwk = keys[0];
  }
  if (!jwk) return null;

  const alg = (jwk.alg as string | undefined) ?? "RS256";
  const algorithm =
    alg === "ES256"
      ? { name: "ECDSA", namedCurve: "P-256" }
      : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

  const cryptoKey = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);

  const cacheKey = kid ?? "__default__";
  jwksCache.set(cacheKey, { key: cryptoKey, fetchedAt: Date.now() });

  return cryptoKey;
}

async function verifyJwt(token: string, issuerUrl: string, allowedAlgorithms?: string[], clockSkewMs = 5000): Promise<JwtPayload | null> {
  try {
    const { header, payload } = decodeJwt(token);

    const alg = (header.alg as string) ?? "RS256";
    if (allowedAlgorithms && allowedAlgorithms.length > 0 && !allowedAlgorithms.includes(alg)) return null;

    const kid = header.kid as string | undefined;
    const jwksUri = `${issuerUrl}/oauth/v2/keys`;

    const cryptoKey = await fetchAndCacheJwks(jwksUri, kid);
    if (!cryptoKey) return null;

    const [h, p, sig] = token.split(".");
    const verifyAlg = alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" };
    const data = new TextEncoder().encode(`${h}.${p}`);
    const valid = await crypto.subtle.verify(verifyAlg, cryptoKey, base64UrlDecode(sig), data);
    if (!valid) return null;

    const now = Date.now();
    if (payload.exp !== undefined && payload.exp * 1000 < now - clockSkewMs) return null;
    if (payload.nbf !== undefined && payload.nbf * 1000 > now + clockSkewMs) return null;
    if (payload.iat !== undefined && payload.iat * 1000 > now + clockSkewMs) return null;

    return payload;
  } catch {
    return null;
  }
}

function matchesRoutes(pathname: string, routes: string[]): boolean {
  if (!routes || routes.length === 0) return false;
  return routes.some((p) =>
    p.endsWith("*") ? pathname.startsWith(p.slice(0, -1)) : pathname === p,
  );
}

/**
 * Creates an H3 event handler that handles proxying, JWT verification, and
 * route protection in a single pass.
 *
 * Register it as a Nitro server middleware in `server/middleware/auth.ts`:
 *
 * ```ts
 * import { createNextgenMiddleware } from "@nextgen/sdk-nuxt/server";
 *
 * export default createNextgenMiddleware({
 *   issuerUrl: process.env.NEXTGEN_ISSUER_URL,
 *   protectedRoutes: ["/admin", "/dashboard*"],
 *   loginPath: "/login",
 * });
 * ```
 *
 * @param options - Middleware configuration options.
 * @returns An H3 event handler suitable for use as a global server middleware.
 */
export function createNextgenMiddleware(options: NextgenModuleOptions = {}) {
  const {
    issuerUrl = process.env.NEXTGEN_ISSUER_URL ?? "http://localhost:4000",
    proxyPath = "/__nextgen",
    protectedRoutes = [],
    ignoredRoutes = [],
    loginPath = "/login",
    allowedAlgorithms,
    clockSkewMs = 5000,
  } = options;

  return defineEventHandler(async (event: H3Event) => {
    const url = getRequestURL(event);
    const { pathname } = url;

    if (matchesRoutes(pathname, ignoredRoutes)) {
      return;
    }

    if (pathname.startsWith(proxyPath)) {
      const suffix = pathname.slice(proxyPath.length);
      const target = `${issuerUrl}${suffix}${url.search}`;

      const reqHeaders = new Headers();
      for (const [k, v] of Object.entries(event.node.req.headers)) {
        if (v && !HOP_BY_HOP.has(k.toLowerCase())) {
          reqHeaders.set(k, Array.isArray(v) ? v.join(", ") : v);
        }
      }

      const method = event.node.req.method ?? "GET";
      const hasBody = !["GET", "HEAD"].includes(method);
      const rawBody = hasBody ? await readRawBody(event, false) : undefined;
      const body = rawBody != null ? new Uint8Array(rawBody) : undefined;
      const upstream = await fetch(target, {
        method,
        headers: reqHeaders,
        body,
        redirect: "manual",
      });

      event.node.res.statusCode = upstream.status;
      for (const [k, v] of upstream.headers.entries()) {
        if (!HOP_BY_HOP.has(k.toLowerCase()) && k.toLowerCase() !== "set-cookie") {
          event.node.res.setHeader(k, v);
        }
      }
      const cookies = upstream.headers.getSetCookie?.() ?? [];
      for (const cookie of cookies) {
        event.node.res.appendHeader("set-cookie", cookie);
      }

      return upstream.body;
    }

    const authHeader = getRequestHeader(event, "authorization");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const cookieToken = getCookie(event, "__nextgen_session");
    const token = bearerToken ?? cookieToken;

    const payload = token ? await verifyJwt(token, issuerUrl, allowedAlgorithms, clockSkewMs) : null;

    if (payload && token) {
      event.context.nextgenAuth = {
        isAuthenticated: true,
        session: {
          userId: payload.sub ?? "",
          email: payload.email ?? null,
          name: payload.name ?? null,
          token,
        },
      };
      return;
    }

    event.context.nextgenAuth = { isAuthenticated: false, session: null };

    if (cookieToken) {
      deleteCookie(event, "__nextgen_session");
    }

    if (matchesRoutes(pathname, protectedRoutes)) {
      await sendRedirect(event, `${loginPath}?next=${encodeURIComponent(pathname)}`, 302);
    }
  });
}

/**
 * Reads the auth state from a Nitro/H3 event context.
 *
 * Call this inside any server route or API handler after the middleware has run:
 *
 * ```ts
 * import { getAuth } from "@nextgen/sdk-nuxt/server";
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
