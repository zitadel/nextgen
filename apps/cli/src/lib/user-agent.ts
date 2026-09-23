/**
 * The `User-Agent` the CLI sends on every HTTP request it makes through
 * undici — the Zitadel API, local-server health checks, branding asset probes
 * — so a server (and its logs and session records) can tell CLI traffic apart
 * from any other Node client, and tell CLI versions apart. Node's `fetch`
 * otherwise sends the bare `node`.
 *
 * Space-separated `product/version` tokens (RFC 9110 §10.1.5), in the style of
 * npm and the AWS CLI, most significant first:
 *
 *     zitadel-cli/1.0.0 node/v24.12.0 darwin/24.6.0 arch/arm64 ci/github_actions host/claude_code
 *
 * `ci/` and `host/` use the vocabulary of the telemetry `ci_provider` and
 * `host_agent` dimensions. They appear only when detected, and never once the
 * user has opted out of telemetry: they describe the user's environment, so
 * the same opt-out covers them.
 */

import { release } from "node:os";

import { type Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from "undici";

import { type Consent, resolveConsent } from "./telemetry/consent";
import { ciProvider } from "./telemetry/dimensions/ci-provider";
import { hostAgent } from "./telemetry/dimensions/host-agent";

const USER_AGENT_HEADER = "user-agent";

/**
 * Consent outcomes that are the user's own choice. A missing ingestion token
 * or a test run also disables telemetry, but says nothing about what the user
 * wants reported.
 */
const OPT_OUT_REASONS: ReadonlySet<Consent["reason"]> = new Set([
  "flag-opt-out",
  "do-not-track",
  "env-opt-out",
]);

/** Process facts the user agent is built from, surfaced as data so it is testable. */
export type UserAgentFacts = {
  readonly cliVersion: string;
  readonly nodeVersion: string;
  readonly platform: NodeJS.Platform;
  readonly osRelease: string;
  readonly arch: string;
  readonly env: NodeJS.ProcessEnv;
  /** The `--telemetry/--no-telemetry` flag, when given. */
  readonly telemetryFlag?: boolean;
};

/** The {@link UserAgentFacts} of the running process. */
export function processUserAgentFacts(
  cliVersion: string,
  telemetryFlag: boolean | undefined,
): UserAgentFacts {
  return {
    cliVersion,
    nodeVersion: process.version,
    platform: process.platform,
    osRelease: release(),
    arch: process.arch,
    env: process.env,
    telemetryFlag,
  };
}

export function buildUserAgent(facts: UserAgentFacts): string {
  const tokens = [
    product("zitadel-cli", facts.cliVersion),
    product("node", facts.nodeVersion),
    product(facts.platform, facts.osRelease),
    product("arch", facts.arch),
  ];
  const consent = resolveConsent({ env: facts.env, flag: facts.telemetryFlag });
  if (!OPT_OUT_REASONS.has(consent.reason)) {
    const ci = ciProvider.value(facts.env);
    if (ci !== undefined) {
      tokens.push(product("ci", ci));
    }
    const host = hostAgent.value(facts.env);
    if (host !== "unknown") {
      tokens.push(product("host", host));
    }
  }
  return tokens.join(" ");
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

/** The installed user agent and the global dispatcher that carries it. */
type UserAgentSlot = {
  userAgent?: string;
  dispatcher?: Dispatcher;
};

/**
 * Stored on `globalThis`, like the dispatcher it wraps, so every copy of this
 * module in the process shares one value: with module-local state, a second
 * copy would compose a second interceptor whose stale value overwrote the
 * first's on every request.
 */
const SLOT = Symbol.for("@zitadel/cli/user-agent");

function slot(): UserAgentSlot {
  const scope = globalThis as Record<symbol, UserAgentSlot | undefined>;
  scope[SLOT] ??= {};
  return scope[SLOT];
}

/**
 * undici interceptor that sets the installed user agent on every request,
 * replacing whatever the caller or `fetch` put there. Exported so a module
 * that builds its own dispatcher (and so bypasses the global one) can
 * compose it; a no-op until {@link installUserAgent} runs.
 */
export const userAgentInterceptor: Dispatcher.DispatcherComposeInterceptor =
  (dispatch) => (options, handler) => {
    const userAgent = slot().userAgent;
    return dispatch(
      userAgent === undefined
        ? options
        : { ...options, headers: withUserAgent(options.headers, userAgent) },
      handler,
    );
  };

/**
 * Make every request through the global dispatcher — which is what `fetch`
 * uses, including the `@zitadel/api` client — carry `userAgent`. Composes
 * onto the existing global dispatcher, so a proxy agent installed before
 * (`NODE_USE_ENV_PROXY`) keeps working. Calling it again only replaces the
 * value, unless something has since swapped the global dispatcher out, in
 * which case the interceptor is composed onto the new one.
 *
 * Importing the `undici` package installs its own `Agent` as the global
 * dispatcher when none is set yet, so Node's bundled `fetch` dispatches
 * through the package's undici. Keep its major version on the one the
 * supported Node release bundles.
 */
export function installUserAgent(userAgent: string): void {
  const state = slot();
  state.userAgent = userAgent;
  const current = getGlobalDispatcher();
  if (current !== state.dispatcher) {
    state.dispatcher = current.compose(userAgentInterceptor);
    setGlobalDispatcher(state.dispatcher);
  }
}

/**
 * Forget the installed user agent. **Test-only**: it does not restore the
 * global dispatcher, which the caller saved and puts back itself.
 */
export function _resetUserAgentForTesting(): void {
  delete (globalThis as Record<symbol, unknown>)[SLOT];
}

/**
 * Rewrite `headers` — in any of the shapes undici accepts — as a flat
 * name/value list with every existing `user-agent` dropped and `userAgent`
 * appended. The flat list keeps repeated headers intact. A malformed
 * odd-length list is returned untouched, for undici to reject.
 */
export function withUserAgent(
  headers: Dispatcher.DispatchOptions["headers"],
  userAgent: string,
): Dispatcher.DispatchOptions["headers"] {
  if (Array.isArray(headers) && headers.length % 2 !== 0) {
    return headers;
  }
  const flat: string[] = [];
  for (const [name, value] of headerEntries(headers)) {
    if (name.toLowerCase() === USER_AGENT_HEADER) {
      continue;
    }
    const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
    for (const item of values) {
      flat.push(name, item);
    }
  }
  flat.push(USER_AGENT_HEADER, userAgent);
  return flat;
}

type HeaderEntry = readonly [string, string | string[] | undefined];

function headerEntries(headers: Dispatcher.DispatchOptions["headers"]): Iterable<HeaderEntry> {
  if (headers == null) {
    return [];
  }
  if (Array.isArray(headers)) {
    const pairs: HeaderEntry[] = [];
    for (let index = 0; index < headers.length; index += 2) {
      // Even length is checked by the caller, so both indexes are in range.
      pairs.push([headers[index] as string, headers[index + 1]]);
    }
    return pairs;
  }
  if (Symbol.iterator in headers) {
    return headers as Iterable<HeaderEntry>;
  }
  return Object.entries(headers);
}
