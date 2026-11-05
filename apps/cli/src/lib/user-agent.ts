/**
 * The `User-Agent` the CLI sends on every HTTP request it makes — the Zitadel
 * API, local-server health checks, branding asset probes, telemetry — so a
 * server (and its logs and session records) can tell CLI traffic apart from any
 * other Node client, and tell CLI versions apart. Node's `fetch` otherwise
 * sends the bare `node`.
 *
 * Space-separated `product/version` tokens (RFC 9110 §10.1.5), in the style of
 * npm and the AWS CLI, most significant first:
 *
 *     zitadel-cli/1.0.0 node/v24.12.0 darwin/24.6.0 arch/arm64
 */

import { release } from "node:os";

/** Process facts the user agent is built from, surfaced as data so it is testable. */
export type UserAgentFacts = {
  readonly cliVersion: string;
  readonly nodeVersion: string;
  readonly platform: NodeJS.Platform;
  readonly osRelease: string;
  readonly arch: string;
};

/** The user agent the facts describe. */
export function buildUserAgent(facts: UserAgentFacts): string {
  return [
    product("zitadel-cli", facts.cliVersion),
    product("node", facts.nodeVersion),
    product(facts.platform, facts.osRelease),
    product("arch", facts.arch),
  ].join(" ");
}

/** The user agent of the running process. */
export function processUserAgent(cliVersion: string): string {
  return buildUserAgent({
    cliVersion,
    nodeVersion: process.version,
    platform: process.platform,
    osRelease: release(),
    arch: process.arch,
  });
}

/**
 * One `name/version` product token. Characters outside the RFC 9110 `token`
 * set (an OS release string is free-form) become `_`, so a stray space or
 * slash can never split one token into two.
 */
function product(name: string, version: string): string {
  return `${sanitizeToken(name)}/${sanitizeToken(version)}`;
}

function sanitizeToken(value: string): string {
  return value.replace(/[^!#$%&'*+\-.^_`|~0-9A-Za-z]/g, "_") || "unknown";
}

/**
 * The user agent of this run, until {@link useUserAgent} sets the real one.
 * A holder rather than a reassigned binding, so the value has one home.
 */
const state = {
  userAgent: processUserAgent("unknown"),
};

/** Set the user agent of this run, which every request the CLI makes carries. */
export function useUserAgent(userAgent: string): void {
  state.userAgent = userAgent;
}

/** The user agent of this run. */
export function userAgent(): string {
  return state.userAgent;
}
