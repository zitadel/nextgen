/**
 * The path the server serves the resource API under (ADR 077). An operation's
 * path in the spec, such as `/users/me`, follows it: `/api/v1/users/me`.
 */
export const API_PREFIX = "/api/v1";

/**
 * `base`, a server's origin or a same-origin proxy path, with
 * {@link API_PREFIX} after it: the base URL every operation's path follows.
 * Trailing slashes go, and a base that already ends in the prefix, as an
 * origin copied together with it might, keeps one.
 */
export function apiBaseUrl(base: string): string {
  let trimmed = base;
  while (trimmed.endsWith("/")) {
    trimmed = trimmed.slice(0, -1);
  }
  if (trimmed.endsWith(API_PREFIX)) {
    trimmed = trimmed.slice(0, -API_PREFIX.length);
  }
  return `${trimmed}${API_PREFIX}`;
}
