import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export interface NextgenConfig {
  /** Full URL of the ZITADEL backend, e.g. https://auth.example.com */
  backendUrl: string;
  /** Secret key used to authenticate proxy-to-backend calls */
  secretKey: string;
  /**
   * Path prefix your rewrite rule forwards to the backend.
   * Default: "/__nextgen"
   */
  proxyPath?: string;
  /**
   * Routes that require a valid session. Glob patterns supported via
   * path-to-regexp, or a function that receives the pathname.
   * Default: [] (no routes protected)
   */
  protectedRoutes?: string[] | ((pathname: string) => boolean);
  /** Where to redirect unauthenticated users. Default: "/" */
  signInUrl?: string;
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

function stripHopByHop(headers: Headers): Headers {
  const out = new Headers(headers);
  for (const name of HOP_BY_HOP) out.delete(name);
  return out;
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

async function proxyRequest(
  req: NextRequest,
  backendUrl: string,
  secretKey: string,
  proxyPath: string,
): Promise<Response> {
  const url = new URL(req.url);
  const suffix = url.pathname.slice(proxyPath.length); // e.g. /v1/flow
  const target = new URL(suffix + url.search, backendUrl);

  const upstreamHeaders = stripHopByHop(req.headers);
  upstreamHeaders.set("Nextgen-Proxy-Url", new URL(proxyPath, req.url).origin + proxyPath);
  upstreamHeaders.set("Nextgen-Secret-Key", secretKey);
  upstreamHeaders.set("X-Forwarded-For", clientIp(req));
  upstreamHeaders.set("X-Forwarded-Host", url.host);
  upstreamHeaders.set("X-Forwarded-Proto", url.protocol.replace(":", ""));

  const upstream = await fetch(target.toString(), {
    method: req.method,
    headers: upstreamHeaders,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
    redirect: "manual",
    // @ts-expect-error -- Node 18+ fetch supports duplex
    duplex: "half",
  });

  const downstreamHeaders = stripHopByHop(upstream.headers);

  // Rewrite any redirect Location back through the proxy
  const location = upstream.headers.get("location");
  if (location) {
    try {
      const loc = new URL(location);
      // Only rewrite if it points at our backend
      const backend = new URL(backendUrl);
      if (loc.host === backend.host) {
        loc.host = url.host;
        loc.protocol = url.protocol;
        loc.pathname = proxyPath + loc.pathname;
        downstreamHeaders.set("location", loc.toString());
      }
    } catch {
      // relative redirect — leave as-is
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: downstreamHeaders,
  });
}

// ---------------------------------------------------------------------------
// JWT verification (Web Crypto, no external library)
// ---------------------------------------------------------------------------

interface JwtPayload {
  sub?: string;
  exp?: number;
  iat?: number;
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

function decodeJwtUnsafe(token: string): { header: Record<string, unknown>; payload: JwtPayload } {
  const [h, p] = token.split(".");
  return {
    header: JSON.parse(new TextDecoder().decode(base64UrlDecode(h))),
    payload: JSON.parse(new TextDecoder().decode(base64UrlDecode(p))),
  };
}

async function importJwk(jwk: JsonWebKey, alg: string): Promise<CryptoKey> {
  const algorithm =
    alg === "RS256"
      ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
      : alg === "ES256"
        ? { name: "ECDSA", namedCurve: "P-256" }
        : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  return crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
}

async function verifyJwtSignature(token: string, key: CryptoKey, alg: string): Promise<boolean> {
  const [h, p, sig] = token.split(".");
  const algorithm =
    alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" };
  const data = new TextEncoder().encode(`${h}.${p}`);
  const signature = base64UrlDecode(sig);
  return crypto.subtle.verify(algorithm, key, signature, data);
}

// Simple in-process JWKS cache
const jwksCache = new Map<string, { keys: JsonWebKey[]; fetchedAt: number }>();
const JWKS_TTL_MS = 5 * 60 * 1000;

async function fetchJwks(jwksUri: string): Promise<JsonWebKey[]> {
  const cached = jwksCache.get(jwksUri);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetch(jwksUri);
  const { keys } = (await res.json()) as { keys: JsonWebKey[] };
  jwksCache.set(jwksUri, { keys, fetchedAt: Date.now() });
  return keys;
}

async function verifySessionJwt(
  token: string,
  backendUrl: string,
): Promise<JwtPayload | null> {
  try {
    const { header, payload } = decodeJwtUnsafe(token);
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;

    const alg = (header.alg as string) ?? "RS256";
    const kid = header.kid as string | undefined;

    const jwksUri = new URL("/.well-known/jwks.json", backendUrl).toString();
    const keys = await fetchJwks(jwksUri);
    const jwk = kid ? keys.find((k) => (k as { kid?: string }).kid === kid) : keys[0];
    if (!jwk) return null;

    const cryptoKey = await importJwk(jwk, alg);
    const valid = await verifyJwtSignature(token, cryptoKey, alg);
    return valid ? payload : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

function isProtected(pathname: string, rules: NextgenConfig["protectedRoutes"]): boolean {
  if (!rules || rules.length === 0) return false;
  if (typeof rules === "function") return rules(pathname);
  return rules.some((pattern) => {
    if (pattern.endsWith("*")) return pathname.startsWith(pattern.slice(0, -1));
    return pathname === pattern;
  });
}

export async function nextgenMiddleware(
  req: NextRequest,
  config: NextgenConfig,
): Promise<NextResponse | Response> {
  const { backendUrl, secretKey, proxyPath = "/__nextgen", protectedRoutes, signInUrl = "/" } =
    config;

  const { pathname } = new URL(req.url);

  // Proxy all /__nextgen/* requests to the backend
  if (pathname.startsWith(proxyPath)) {
    return proxyRequest(req, backendUrl, secretKey, proxyPath);
  }

  // JWT gate for protected routes
  if (isProtected(pathname, protectedRoutes)) {
    const token = req.cookies.get("__nextgen_session")?.value;
    if (!token) {
      const signIn = new URL(signInUrl, req.url);
      signIn.searchParams.set("next", pathname);
      return NextResponse.redirect(signIn);
    }

    const payload = await verifySessionJwt(token, backendUrl);
    if (!payload) {
      const signIn = new URL(signInUrl, req.url);
      signIn.searchParams.set("next", pathname);
      return NextResponse.redirect(signIn);
    }

    // Forward decoded claims to route handlers via a request header
    const res = NextResponse.next();
    res.headers.set("x-nextgen-user", JSON.stringify({ sub: payload.sub, ...payload }));
    return res;
  }

  return NextResponse.next();
}
