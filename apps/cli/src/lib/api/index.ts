import type { PlatformClient } from "./client";
import { HttpPlatformClient } from "./http-client";

export { DEFAULT_SERVER, resolveServer } from "./resolve-server";
export type { ResolvedServer, ResolveServerInput } from "./resolve-server";

/**
 * Constructs the {@link PlatformClient} the CLI commands depend on. This
 * factory is the single entry point callers use so they stay decoupled
 * from the concrete {@link HttpPlatformClient} implementation. The
 * `secret` is optional because read-only flows (and the mock server)
 * operate without bearer auth; when present it is sent as a bearer token
 * on every request.
 */
export function createPlatformClient(source: string, secret?: string): PlatformClient {
  return new HttpPlatformClient(source, secret);
}
