import type { H3Event } from "h3";
import {
  defineEventHandler,
  getCookie,
  getHeader,
  getRequestURL,
  readRawBody,
  sendRedirect,
  setResponseHeader,
} from "h3";

export interface NextgenNuxtConfig {
  backendUrl: string;
  secretKey: string;
  proxyPath?: string;
  protectedRoutes?: string[] | ((pathname: string) => boolean);
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

// ---------------------------------------------------------------------------
// JWT helpers (mirrors sdk-next, no shared dep by design)
// ---------------------------------------------------------------------------

interface JwtPayload {
  sub?: string;
  exp?: number;
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

function decodeJwtUnsafe(token: string) {
  const [h, p] = token.split(".");
  return {
    header: JSON.parse(new TextDecoder().decode(base64UrlDecode(h))) as Record<string, unknown>,
    payload: JSON.parse(new TextDecoder().decode(base64UrlDecode(p))) as JwtPayload,
  };
}

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

async function verifySessionJwt(token: string, backendUrl: string): Promise<JwtPayload | null> {
  try {
    const { header, payload } = decodeJwtUnsafe(token);
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;

    const alg = (header.alg as string) ?? "RS256";
    const kid = header.kid as string | undefined;
    const jwksUri = new URL("/.well-known/jwks.json", backendUrl).toString();
    const keys = await fetchJwks(jwksUri);
    const jwk = kid ? keys.find((k) => (k as { kid?: string }).kid === kid) : keys[0];
    if (!jwk) return null;

    const algorithm =
      alg === "ES256"
        ? { name: "ECDSA", namedCurve: "P-256" }
        : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

    const cryptoKey = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);

    const [h, p, sig] = token.split(".");
    const verifyAlg = alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" };
    const data = new TextEncoder().encode(`${h}.${p}`);
    const valid = await crypto.subtle.verify(verifyAlg, cryptoKey, base64UrlDecode(sig), data);
    return valid ? payload : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Proxy handler
// ---------------------------------------------------------------------------

function isProtected(pathname: string, rules: NextgenNuxtConfig["protectedRoutes"]): boolean {
  if (!rules || rules.length === 0) return false;
  if (typeof rules === "function") return rules(pathname);
  return (rules as string[]).some((p) =>
    p.endsWith("*") ? pathname.startsWith(p.slice(0, -1)) : pathname === p,
  );
}

export function createNextgenProxyHandler(config: NextgenNuxtConfig) {
  const { backendUrl, secretKey, proxyPath = "/__nextgen" } = config;

  return defineEventHandler(async (event: H3Event) => {
    const url = getRequestURL(event);
    const suffix = url.pathname.slice(proxyPath.length);
    const target = new URL(suffix + url.search, backendUrl);

    const reqHeaders = new Headers();
    for (const [k, v] of Object.entries(event.node.req.headers)) {
      if (v && !HOP_BY_HOP.has(k.toLowerCase())) {
        reqHeaders.set(k, Array.isArray(v) ? v.join(", ") : v);
      }
    }
    reqHeaders.set("Nextgen-Proxy-Url", url.origin + proxyPath);
    reqHeaders.set("Nextgen-Secret-Key", secretKey);
    reqHeaders.set(
      "X-Forwarded-For",
      getHeader(event, "x-forwarded-for") ??
        event.node.req.socket?.remoteAddress ??
        "unknown",
    );

    const method = event.node.req.method ?? "GET";
    const rawBody =
      ["GET", "HEAD"].includes(method) ? null : await readRawBody(event, false);
    const body: Uint8Array<ArrayBuffer> | null =
      rawBody != null ? new Uint8Array(rawBody) : null;

    const upstream = await fetch(target.toString(), {
      method,
      headers: reqHeaders,
      body: body,
      redirect: "manual",
    });

    event.node.res.statusCode = upstream.status;
    for (const [k, v] of upstream.headers.entries()) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) {
        event.node.res.setHeader(k, v);
      }
    }

    return upstream.body;
  });
}

export function createNextgenAuthMiddleware(config: NextgenNuxtConfig) {
  const { backendUrl, protectedRoutes, signInUrl = "/" } = config;

  return defineEventHandler(async (event: H3Event) => {
    const url = getRequestURL(event);

    if (!isProtected(url.pathname, protectedRoutes)) return;

    const token = getCookie(event, "__nextgen_session");
    if (!token) {
      await sendRedirect(event, `${signInUrl}?next=${encodeURIComponent(url.pathname)}`, 302);
      return;
    }

    const payload = await verifySessionJwt(token, backendUrl);
    if (!payload) {
      await sendRedirect(event, `${signInUrl}?next=${encodeURIComponent(url.pathname)}`, 302);
      return;
    }

    setResponseHeader(event, "x-nextgen-user", JSON.stringify({ sub: payload.sub, ...payload }));
  });
}
