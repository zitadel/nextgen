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
 * import { handleProxy, resolveConfig } from '@zitadel-nextgen/edge-proxy';
 *
 * const config = resolveConfig({ apiUrl: env.NEXTGEN_API_URL });
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
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

// ─── Public types ─────────────────────────────────────────────────────────────

/** Thrown by {@link resolveConfig} when the supplied configuration is invalid. */
export class EdgeProxyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EdgeProxyConfigError';
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
   * Additional headers injected into every upstream request.
   * Applied after hop-by-hop stripping and X-Forwarded-* injection,
   * so these can override any forwarded header.
   */
  additionalHeaders?: Record<string, string> | undefined;
}

/** Resolved, normalised configuration with all defaults applied. */
export interface ResolvedConfig {
  readonly apiUrl: string;
  readonly pathPrefix: string;
  readonly stripPrefix: boolean;
  readonly additionalHeaders: Record<string, string>;
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
    throw new EdgeProxyConfigError('apiUrl is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(config.apiUrl);
  } catch {
    throw new EdgeProxyConfigError(`Invalid apiUrl: "${config.apiUrl}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new EdgeProxyConfigError(
      `apiUrl must use http or https protocol, got: "${parsed.protocol}"`,
    );
  }

  const pathPrefix = config.pathPrefix ?? '/__nextgen';
  if (!pathPrefix.startsWith('/')) {
    throw new EdgeProxyConfigError(
      `pathPrefix must start with "/", got: "${pathPrefix}"`,
    );
  }

  return {
    apiUrl: config.apiUrl,
    pathPrefix,
    stripPrefix: config.stripPrefix ?? true,
    additionalHeaders: config.additionalHeaders ?? {},
  };
}

// ─── Internal header building ─────────────────────────────────────────────────

/**
 * Builds the header set to forward to the upstream server.
 *
 * - Strips all hop-by-hop headers from the incoming request.
 * - Injects `additionalHeaders` last (can override any forwarded header).
 * - Sets `X-Forwarded-For` only when absent, from `cf-connecting-ip` or
 *   `x-real-ip`. Never overwrites an existing CDN chain.
 * - Sets `X-Forwarded-Host` and `X-Forwarded-Proto` only when absent,
 *   preserving values already set by an upstream CDN or load balancer.
 *
 * Not exported — internal implementation detail.
 */
function buildUpstreamHeaders(
  req: Request,
  url: URL,
  config: ResolvedConfig,
): Headers {
  const headers = new Headers();

  for (const [k, v] of req.headers.entries()) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) {
      headers.set(k, v);
    }
  }

  for (const [k, v] of Object.entries(config.additionalHeaders)) {
    headers.set(k, v);
  }

  if (!headers.has('x-forwarded-for')) {
    const ip =
      req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip');
    if (ip !== null) {
      headers.set('x-forwarded-for', ip);
    }
  }

  if (!headers.has('x-forwarded-host')) {
    headers.set('x-forwarded-host', url.host);
  }

  if (!headers.has('x-forwarded-proto')) {
    headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
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
 * headers are preserved individually via `Headers.getSetCookie()`.
 * 3xx redirects are passed through unchanged (`redirect: 'manual'`).
 *
 * @param req    - The incoming edge request.
 * @param config - Resolved proxy configuration from {@link resolveConfig}.
 * @returns The proxied upstream `Response`, or `null` if the path does not match.
 */
export async function handleProxy(
  req: Request,
  config: ResolvedConfig,
): Promise<Response | null> {
  const url = new URL(req.url);

  if (!url.pathname.startsWith(config.pathPrefix)) {
    return null;
  }
  // Prevent matching a path that shares a prefix but continues with non-slash
  // characters (e.g. pathPrefix='/__nextgen' must NOT match '/__nextgen_other').
  const charAfterPrefix = url.pathname[config.pathPrefix.length];
  if (charAfterPrefix !== undefined && charAfterPrefix !== '/') {
    return null;
  }

  const base = new URL(config.apiUrl);
  const upstream = new URL(req.url);
  upstream.protocol = base.protocol;
  upstream.host = base.host;
  upstream.pathname = config.stripPrefix
    ? url.pathname.slice(config.pathPrefix.length) || '/'
    : url.pathname;

  const headers = buildUpstreamHeaders(req, url, config);
  const hasBody = !['GET', 'HEAD'].includes(req.method);

  const upstreamRes = await fetch(upstream.toString(), {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    redirect: 'manual',
    // duplex is required by the Fetch spec for streaming request bodies but is
    // not yet present in TypeScript's RequestInit. Cast suppresses the error.
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit);

  const responseHeaders = new Headers();
  for (const [k, v] of upstreamRes.headers.entries()) {
    if (!HOP_BY_HOP.has(k.toLowerCase()) && k.toLowerCase() !== 'set-cookie') {
      responseHeaders.set(k, v);
    }
  }

  // getSetCookie() preserves multiple Set-Cookie headers individually.
  // Headers.get('set-cookie') collapses them into a comma-joined string,
  // which breaks cookies whose values contain commas (e.g. Expires dates).
  for (const cookie of upstreamRes.headers.getSetCookie?.() ?? []) {
    responseHeaders.append('set-cookie', cookie);
  }

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: responseHeaders,
  });
}
