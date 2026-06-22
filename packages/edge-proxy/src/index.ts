/**
 * Platform-agnostic edge proxy handler for the Zitadel nextgen flow API.
 *
 * Built entirely from WinterTC-standard globals (fetch, Request, Response,
 * URL, Headers) with no platform-specific imports. Runs identically on
 * Cloudflare Workers, Vercel Edge Functions, and Netlify Edge Functions.
 *
 * @example
 * ```ts
 * // Cloudflare Workers
 * import { handleProxy, resolveConfig } from '@zitadel/edge-proxy';
 *
 * const config = resolveConfig({
 *   apiUrl: env.NEXTGEN_API_URL,
 *   projectSecret: env.ZITADEL_PROJECT_SECRET,
 * });
 * const res = await handleProxy(req, config);
 * if (res) return res;
 * return env.ASSETS.fetch(req); // fall through to static assets
 * ```
 */

/**
 * Headers that must never be forwarded to an upstream service.
 * Connection-level headers that are only meaningful between two directly
 * connected peers — they become invalid when proxied.
 */
const HOP_BY_HOP: ReadonlySet<string> = new Set([
  "connection",
  // host is not a hop-by-hop header per RFC 7230, but it must be stripped so
  // the fetch implementation derives the correct Host from the upstream URL
  // rather than forwarding the client's Host and causing SNI/vhost mismatches.
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

// ─── Public types ─────────────────────────────────────────────────────────────

/** Thrown by {@link resolveConfig} when the supplied configuration is invalid. */
export class EdgeProxyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdgeProxyConfigError";
  }
}

/** User-facing configuration passed to {@link resolveConfig}. */
export interface EdgeProxyConfig {
  /**
   * Base URL of the Zitadel nextgen API backend.
   * Must be a valid http or https URL.
   * @example 'https://api.example.com'
   */
  apiUrl: string;
  /**
   * URL path prefix this handler intercepts.
   * Must start with '/'. Defaults to `'/__nextgen'`.
   */
  pathPrefix?: string | undefined;
  /**
   * When `true` (default), the `pathPrefix` is stripped from the upstream
   * path. When `false`, the full path is forwarded unchanged.
   */
  stripPrefix?: boolean | undefined;
  /**
   * The project service-key secret. When set, it is attached as
   * `Authorization: Bearer <projectSecret>` on every proxied upstream request.
   * Any client-supplied `Authorization` is stripped first (the browser must not
   * control the upstream credential), so this is only skipped when a caller
   * sets `Authorization` via {@link EdgeProxyConfig.additionalHeaders}. The
   * backend's security handler verifies it cryptographically.
   *
   * This is what keeps the secret server-side: the value is read from a
   * platform env var inside the edge runtime (`ZITADEL_PROJECT_SECRET`) and
   * never reaches the browser. A static rewrite rule cannot do this, which is
   * why a worker / edge function is required rather than plain config.
   */
  projectSecret?: string | undefined;
  /**
   * Additional headers injected into every upstream request. Applied after
   * hop-by-hop stripping and before the `X-Forwarded-*` defaults; since those
   * defaults only fill in absent values, anything set here still takes
   * precedence over them.
   */
  additionalHeaders?: Record<string, string> | undefined;
  /**
   * Timeout in milliseconds for upstream proxy requests.
   * Requests that do not complete within this window are aborted with a
   * network error. Defaults to 5 000 ms.
   * @default 5000
   */
  proxyTimeoutMs?: number | undefined;
}

/** Resolved, normalised configuration with all defaults applied. */
export interface ResolvedConfig {
  readonly apiUrl: string;
  readonly pathPrefix: string;
  readonly stripPrefix: boolean;
  readonly projectSecret: string;
  readonly additionalHeaders: Record<string, string>;
  readonly proxyTimeoutMs: number;
}

// ─── Config resolution ────────────────────────────────────────────────────────

/**
 * Validates and normalises an {@link EdgeProxyConfig}, applying defaults.
 *
 * @throws {@link EdgeProxyConfigError} when `apiUrl` is missing, not a valid
 *   URL, uses a non-http/s protocol, or `pathPrefix` does not start with `/`.
 */
export function resolveConfig(config: EdgeProxyConfig): ResolvedConfig {
  if (!config.apiUrl) {
    throw new EdgeProxyConfigError("apiUrl is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(config.apiUrl);
  } catch {
    throw new EdgeProxyConfigError(`Invalid apiUrl: "${config.apiUrl}"`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new EdgeProxyConfigError(
      `apiUrl must use http or https protocol, got: "${parsed.protocol}"`,
    );
  }

  let pathPrefix = config.pathPrefix ?? "/__nextgen";
  if (!pathPrefix.startsWith("/")) {
    throw new EdgeProxyConfigError(`pathPrefix must start with "/", got: "${pathPrefix}"`);
  }
  // Normalize away a trailing slash (e.g. "/__nextgen/" -> "/__nextgen") so the
  // boundary check in handleProxy still matches child paths like
  // "/__nextgen/auth". The root prefix "/" is left as-is.
  if (pathPrefix.length > 1 && pathPrefix.endsWith("/")) {
    pathPrefix = pathPrefix.slice(0, -1);
  }

  return {
    apiUrl: config.apiUrl,
    pathPrefix,
    stripPrefix: config.stripPrefix ?? true,
    projectSecret: config.projectSecret ?? "",
    additionalHeaders: config.additionalHeaders ?? {},
    proxyTimeoutMs: config.proxyTimeoutMs ?? 5000,
  };
}

// ─── Internal header building ─────────────────────────────────────────────────

/**
 * Builds the header set to forward to the upstream server.
 *
 * - Strips all hop-by-hop headers, plus any client-supplied `Authorization`
 *   (the proxy is the trust boundary; the browser must not set the upstream
 *   credential).
 * - Injects `additionalHeaders` (can override any forwarded header).
 * - Attaches the project service-key as `Authorization: Bearer <secret>` when
 *   `config.projectSecret` is set and `additionalHeaders` did not already set
 *   one — the secret never reaches the browser because this runs in the edge
 *   runtime, not the client.
 * - Sets `X-Forwarded-For` only when absent, from `cf-connecting-ip` or
 *   `x-real-ip`. Never overwrites an existing CDN chain.
 * - Sets `X-Forwarded-Host` and `X-Forwarded-Proto` only when absent,
 *   preserving values already set by an upstream CDN or load balancer.
 *
 * Not exported — internal implementation detail.
 */
function buildUpstreamHeaders(req: Request, url: URL, config: ResolvedConfig): Headers {
  // RFC 7230 §6.1: the Connection header may name additional headers that are
  // hop-by-hop for this specific connection and must also be stripped.
  const connectionValue = req.headers.get("connection") ?? "";
  const dynamicHopByHop = new Set(
    connectionValue
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  const headers = new Headers();

  for (const [k, v] of req.headers.entries()) {
    const lower = k.toLowerCase();
    // The proxy is the trust boundary: never forward a client-supplied
    // Authorization header. The backend is authenticated by the project
    // service-key injected below, and letting the browser set Authorization
    // would let it suppress or replace that trusted credential.
    if (!HOP_BY_HOP.has(lower) && !dynamicHopByHop.has(lower) && lower !== "authorization") {
      headers.set(k, v);
    }
  }

  for (const [k, v] of Object.entries(config.additionalHeaders)) {
    headers.set(k, v);
  }

  // Attach the project service-key as the bearer token. The client's own
  // Authorization was stripped above, so this is set unless a caller explicitly
  // provided one via additionalHeaders. The secret is read from a platform env
  // var inside the edge runtime, so it never reaches the browser.
  if (config.projectSecret && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${config.projectSecret}`);
  }

  if (!headers.has("x-forwarded-for")) {
    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
    if (ip !== null) {
      headers.set("x-forwarded-for", ip);
    }
  }

  if (!headers.has("x-forwarded-host")) {
    headers.set("x-forwarded-host", url.host);
  }

  if (!headers.has("x-forwarded-proto")) {
    headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  }

  return headers;
}

// ─── Proxy handler ────────────────────────────────────────────────────────────

/**
 * Proxies an incoming request to the upstream API when its path matches
 * `config.pathPrefix`, streaming the response back verbatim.
 *
 * Returns `null` for requests that do not match — allowing the caller to
 * fall through to static asset serving (Cloudflare ASSETS, Vercel CDN, etc.).
 *
 * Hop-by-hop headers are stripped in both directions. Multiple `Set-Cookie`
 * headers are preserved individually via `Headers.getSetCookie()`. It uses
 * `redirect: 'manual'` and, on 3xx responses only, strips the upstream
 * `Location` header so internal backend URLs never leak — a 3xx status is
 * forwarded without its redirect target, while `Location` on other statuses
 * (e.g. `201 Created`) is preserved. An upstream timeout yields `504` and a
 * connection failure `502`, rather than throwing.
 *
 * @param req    - The incoming edge request.
 * @param config - Resolved proxy configuration from {@link resolveConfig}.
 * @returns The proxied upstream `Response`, or `null` if the path does not match.
 */
export async function handleProxy(req: Request, config: ResolvedConfig): Promise<Response | null> {
  const url = new URL(req.url);

  if (!url.pathname.startsWith(config.pathPrefix)) {
    return null;
  }
  // Prevent matching a path that shares a prefix but continues with non-slash
  // characters (e.g. pathPrefix='/__nextgen' must NOT match '/__nextgen_other').
  const charAfterPrefix = url.pathname[config.pathPrefix.length];
  if (charAfterPrefix !== undefined && charAfterPrefix !== "/") {
    return null;
  }

  const base = new URL(config.apiUrl);
  const upstream = new URL(req.url);
  upstream.protocol = base.protocol;
  upstream.host = base.host;
  // Preserve any base path embedded in apiUrl (e.g. https://api.example.com/v2).
  // Trailing slash on base path is stripped to avoid double-slash when joining.
  const basePath = base.pathname.replace(/\/$/, "");
  upstream.pathname = config.stripPrefix
    ? basePath + (url.pathname.slice(config.pathPrefix.length) || "/")
    : basePath + url.pathname;

  const headers = buildUpstreamHeaders(req, url, config);
  const hasBody = !["GET", "HEAD"].includes(req.method);

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream.toString(), {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(config.proxyTimeoutMs),
      // duplex is required by the Fetch spec for streaming request bodies but is
      // not yet present in TypeScript's RequestInit. Cast suppresses the error.
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch (error) {
    // Translate upstream timeout/connection failures into a clean gateway
    // status instead of letting the rejection surface as an opaque platform
    // 500. AbortSignal.timeout rejects with a DOMException named "TimeoutError"
    // — and DOMException does not extend Error on workerd/Deno, so check the
    // name structurally rather than via `instanceof Error`.
    const name =
      typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
    return new Response(null, { status: name === "TimeoutError" ? 504 : 502 });
  }

  // `Location` is stripped only for 3xx redirects, where it would leak an
  // internal upstream URL the browser can't reach. It is preserved for other
  // statuses (e.g. a 201 Created pointing at the new resource).
  const isRedirect = upstreamRes.status >= 300 && upstreamRes.status < 400;
  // getSetCookie() preserves multiple Set-Cookie headers individually (the
  // iterator collapses them into one comma-joined value). When the runtime
  // provides it we re-add cookies from it below and skip set-cookie in the loop;
  // when it doesn't, we must still forward the collapsed value rather than drop
  // cookies entirely (which would break login/session flows).
  const setCookies = upstreamRes.headers.getSetCookie?.();
  const responseHeaders = new Headers();
  for (const [k, v] of upstreamRes.headers.entries()) {
    const lower = k.toLowerCase();
    if (HOP_BY_HOP.has(lower)) {
      continue;
    }
    if (lower === "location" && isRedirect) {
      continue;
    }
    if (lower === "set-cookie") {
      if (setCookies === undefined) {
        responseHeaders.append("set-cookie", v);
      }
      continue;
    }
    responseHeaders.set(k, v);
  }

  for (const cookie of setCookies ?? []) {
    responseHeaders.append("set-cookie", cookie);
  }

  // The Fetch spec forbids a body on null-body statuses; constructing a Response
  // with one throws on strict runtimes. Upstream 204/205/304 responses normally
  // have a null body already, but guard explicitly so a non-conformant upstream
  // can't crash the proxy.
  const nullBodyStatus =
    upstreamRes.status === 204 || upstreamRes.status === 205 || upstreamRes.status === 304;
  return new Response(nullBodyStatus ? null : upstreamRes.body, {
    status: upstreamRes.status,
    headers: responseHeaders,
  });
}
