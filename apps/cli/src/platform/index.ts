import type { PlatformClient } from "./client";
import { HttpPlatformClient } from "./http-client";

export { DEFAULT_SERVER, resolveServer } from "./resolve-server";
export type { ResolvedServer, ResolveServerInput } from "./resolve-server";

export function createPlatformClient(source: string, secret?: string): PlatformClient {
  return new HttpPlatformClient(source, secret);
}
