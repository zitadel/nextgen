/**
 * Public surface for the CLI's API utilities. Callers consume the
 * orval-generated client from `@zitadel-nextgen/api` directly; this
 * module owns only the CLI-specific concerns that aren't part of the
 * wire protocol: server URL resolution (which Zitadel to talk to) and
 * the environment-tag enum used by `plan` / `apply`.
 */
export { DEFAULT_SERVER, resolveServer } from "./resolve-server";
export type { ResolvedServer, ResolveServerInput } from "./resolve-server";
