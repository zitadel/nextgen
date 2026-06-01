/**
 * Shared constants and utility functions for the SDK middleware proxy layer.
 *
 * These are consumed by both `sdk-next` and `sdk-nuxt` to avoid duplicating
 * pure, framework-agnostic logic.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Headers that must never be forwarded to an upstream service.
 * These are connection-level headers that are meaningful only between
 * two directly connected peers and become invalid when proxied.
 */
export const HOP_BY_HOP: ReadonlySet<string> = new Set([
  'connection',
  // host is not a hop-by-hop header per RFC 7230, but it must be stripped so
  // the fetch implementation derives the correct Host from the upstream URL
  // rather than forwarding the client's Host and causing SNI/vhost mismatches.
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * SDK-internal headers that must never be forwarded to the upstream backend.
 * These headers carry session data between the middleware and server components;
 * forwarding them upstream would expose internal state and allow header injection.
 */
export const INTERNAL_HEADERS: ReadonlySet<string> = new Set([
  'x-nextgen-auth-token',
]);


// ─── Route matching ──────────────────────────────────────────────────────────

/**
 * Returns `true` when `pathname` matches at least one entry in `routes`.
 *
 * An entry ending with `*` matches any path that starts with the prefix
 * before the `*`. All other entries require an exact match.
 *
 * @param pathname - The URL pathname to test.
 * @param routes   - The list of route patterns to match against.
 * @returns `true` if at least one pattern matches.
 */
export function matchesRoutes(
  pathname: string,
  routes: readonly string[],
): boolean {
  if (routes.length === 0) {
    return false;
  }
  return routes.some((pattern) => {
    if (pattern.endsWith('*')) {
      return pathname.startsWith(pattern.slice(0, -1));
    }
    return pathname === pattern;
  });
}

// ─── Response header filtering ───────────────────────────────────────────────

/**
 * Filters upstream response headers for proxying: strips hop-by-hop headers,
 * `set-cookie` (handled separately via `getSetCookie()`), and `location`
 * (prevents leaking internal upstream URLs).
 *
 * @param upstream - The upstream response headers.
 * @returns A new `Headers` object with filtered headers.
 */
export function filterResponseHeaders(upstream: Headers): Headers {
  const filtered = new Headers();
  for (const [key, value] of upstream.entries()) {
    if (
      !HOP_BY_HOP.has(key.toLowerCase()) &&
      key.toLowerCase() !== 'set-cookie' &&
      key.toLowerCase() !== 'location'
    ) {
      filtered.set(key, value);
    }
  }
  return filtered;
}
