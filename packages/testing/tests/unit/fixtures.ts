import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setupServer } from "msw/node";
import { test as base } from "vitest";

/**
 * `test` with the resources the unit tests of this package need: a test that names one in its first
 * argument gets it, and the teardown runs after the test whether it passed or not.
 *
 * - `dir` is a fresh temp directory, removed when the test ends.
 * - `port` is a free port the operating system picked, held by a listener until the test ends so no
 *   other test is handed it.
 * - `server` is an MSW server listening for the test, one that fails a request nothing handled.
 */
export const it = base.extend<{
  dir: string;
  port: number;
  server: ReturnType<typeof setupServer>;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async dir({}, use) {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-testing-"));
    await use(dir);
    await rm(dir, { recursive: true, force: true });
  },
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async port({}, use) {
    const holder = createServer();
    await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", () => resolve()));
    await use((holder.address() as AddressInfo).port);
    await new Promise<void>((resolve) => holder.close(() => resolve()));
  },
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async server({}, use) {
    const server = setupServer();
    server.listen({ onUnhandledRequest: "error" });
    await use(server);
    server.resetHandlers();
    server.close();
  },
});
