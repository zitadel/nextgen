/**
 * The path the server serves the resource API under (ADR 077). An operation's
 * path in the spec, such as `/users/me`, follows it: `/api/v1/users/me`.
 */
export const API_PREFIX = "/api/v1";

let proxyPath = "";

export function getProxyPath(): string {
  return proxyPath;
}

export function setProxyPath(path: string): void {
  proxyPath = path;
}
