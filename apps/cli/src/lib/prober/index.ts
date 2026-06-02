/**
 * Public surface of the prober. Two narrow primitives, both Zitadel-agnostic:
 *
 * - {@link listListeningPorts} — enumerate loopback TCP ports in LISTEN state
 *   via `lsof`; returns `[]` on any failure.
 * - {@link probeUrl} / {@link probeUrls} — `fetch` with a per-call timeout
 *   plus a caller-supplied predicate that decides what counts as a match.
 *
 * Together they're enough to do "scan localhost for an OIDC server" (the
 * setup wizard's `ServerPrompt` is the first consumer), but neither half
 * knows or cares about Zitadel. New consumers — "find a local dev gateway,"
 * "wait for a service to come up" — would reuse these without changes.
 *
 * **Dependency rule.** This module talks to the network and spawns
 * `lsof`. It has no filesystem dependencies and no domain knowledge of
 * `lib/flows` / `lib/user-schema` / `lib/sync`. Callers (today the setup
 * prompt under `commands/setup/prompts/`) wire it to their own predicate.
 */
export type { ProbeMatch, ProbePredicate } from "./types";
export { listListeningPorts } from "./ports";
export { probeUrl, probeUrls } from "./http";
