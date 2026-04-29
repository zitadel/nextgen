import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { NextgenMiddlewareOptions } from "./types";

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

/**
 * Decodes a Base64URL-encoded string into a byte array.
 *
 * @param input - A Base64URL-encoded string.
 * @returns The decoded bytes.
 */
export function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf;
}

interface JwtPayload {
  sub?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  email?: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * Decodes a JWT into its header and payload without verifying the signature.
 *
 * @param token - A compact-serialized JWT string.
 * @returns The decoded header and payload objects.
 */
export function decodeJwt(token: string): {
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

function tunnelHeaders(req: NextRequest, extra: Record<string, string>): Headers {
  const headers = new Headers(req.headers);
  const overrideNames: string[] = [];
  for (const [name, value] of Object.entries(extra)) {
    headers.set(name, value);
    headers.set(`x-middleware-request-${name}`, value);
    overrideNames.push(name);
  }
  const existing = headers.get("x-middleware-override-headers") ?? "";
  const combined = existing
    ? `${existing},${overrideNames.join(",")}`
    : overrideNames.join(",");
  headers.set("x-middleware-override-headers", combined);
  return headers;
}

/**
 * Next.js Edge middleware that handles proxying, JWT verification, and route
 * protection in a single pass.
 *
 * Place this in your `proxy.ts` file and export it as `proxy`:
 *
 * ```ts
 * import { nextgenMiddleware } from "@zitadel/sdk-next";
 * import type { NextRequest } from "next/server";
 *
 * export function proxy(req: NextRequest) {
 *   return nextgenMiddleware(req, {
 *     issuerUrl: process.env.NEXTGEN_ISSUER_URL,
 *     protectedRoutes: ["/admin", "/dashboard*"],
 *     loginPath: "/login",
 *   });
 * }
 *
 * export const config = {
 *   matcher: ["/__nextgen/:path*", "/admin", "/login"],
 * };
 * ```
 *
 * @param req - The incoming Next.js edge request.
 * @param options - Middleware configuration options.
 * @returns A `NextResponse` or `Response` to continue, redirect, or proxy.
 */
export async function nextgenMiddleware(
  req: NextRequest,
  options: NextgenMiddlewareOptions = {},
): Promise<NextResponse | Response> {
  const {
    issuerUrl = process.env.NEXTGEN_ISSUER_URL ?? "http://localhost:4000",
    proxyPath = "/__nextgen",
    protectedRoutes = [],
    ignoredRoutes = [],
    loginPath = "/login",
    allowedAlgorithms,
    clockSkewMs = 5000,
  } = options;

  const { pathname } = new URL(req.url);

  if (matchesRoutes(pathname, ignoredRoutes)) {
    return NextResponse.next();
  }

  if (pathname.startsWith(proxyPath)) {
    const suffix = pathname.slice(proxyPath.length);
    const upstreamUrl = new URL(req.url);
    const target = `${issuerUrl}${suffix}${upstreamUrl.search}`;

    const upstreamHeaders = new Headers();
    for (const [k, v] of req.headers.entries()) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) {
        upstreamHeaders.set(k, v);
      }
    }

    const hasBody = !["GET", "HEAD"].includes(req.method);
    const upstream = await fetch(target, {
      method: req.method,
      headers: upstreamHeaders,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: new Headers(upstream.headers),
    });
  }

  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieToken = req.cookies.get("__nextgen_session")?.value;
  const token = bearerToken ?? cookieToken;

  const payload = token ? await verifyJwt(token, issuerUrl, allowedAlgorithms, clockSkewMs) : null;

  if (payload && token) {
    const tunnelled = tunnelHeaders(req, { "x-nextgen-auth-token": token });
    return NextResponse.next({ request: { headers: tunnelled } });
  }

  const tunnelled = tunnelHeaders(req, { "x-nextgen-auth-token": "" });
  const response = NextResponse.next({ request: { headers: tunnelled } });

  if (cookieToken) {
    response.cookies.delete("__nextgen_session");
  }

  if (matchesRoutes(pathname, protectedRoutes)) {
    const loginUrl = new URL(loginPath, req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl, { status: 302 });
  }

  return response;
}
