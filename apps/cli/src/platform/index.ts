import type { PlatformClient } from "./client";
import { HttpPlatformClient } from "./http-client";
import { MockPlatformClient } from "./mock-client";
import { MOCK_SENTINEL } from "./resolve-server";

export { DEFAULT_SERVER, MOCK_SENTINEL, resolveServer } from "./resolve-server";
export type { ResolvedServer, ResolveServerInput } from "./resolve-server";

export function createPlatformClient(source: string, secret?: string): PlatformClient {
  if (source === MOCK_SENTINEL) {
    return new MockPlatformClient();
  }
  return new HttpPlatformClient(source, secret);
}
