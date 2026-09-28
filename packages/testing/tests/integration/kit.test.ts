import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { startLocalZitadel } from "../../src/index";

const serverBinary = process.env.ZITADEL_SERVER_BINARY;

// Run via `moon run testing:test-integration`: the task builds the server
// binary and the CLI, and injects ZITADEL_SERVER_BINARY.
describe.skipIf(!serverBinary)("startLocalZitadel (real instance)", () => {
  it("boots, seeds loginable users, and tears down cleanly", async () => {
    const bootStarted = performance.now();
    const zitadel = await startLocalZitadel({
      serverBinary,
      appOrigins: ["http://localhost:3002"],
    });
    const bootMs = Math.round(performance.now() - bootStarted);
    // eslint-disable-next-line no-console
    console.info(`[testing] instance ready in ${bootMs}ms at ${zitadel.handle.baseUrl}`);

    try {
      const seedStarted = performance.now();
      const [alice, bob] = await Promise.all([zitadel.seedUser(), zitadel.seedUser()]);
      const seedMs = Math.round(performance.now() - seedStarted);
      // eslint-disable-next-line no-console
      console.info(`[testing] seeded 2 users concurrently in ${seedMs}ms`);

      expect(alice.id).not.toBe(bob.id);
      expect(alice.email).not.toBe(bob.email);

      const { users } = await zitadel.api.queryUsers({});
      const ids = users.map((user) => user.id);
      expect(ids).toContain(alice.id);
      expect(ids).toContain(bob.id);
    } finally {
      await zitadel.stop();
    }

    // The owned temp dir is removed and the server process group is gone.
    await expect(access(zitadel.runtime.dir)).rejects.toMatchObject({ code: "ENOENT" });
    expect(isProcessAlive(zitadel.runtime.pid)).toBe(false);
  });
});

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
