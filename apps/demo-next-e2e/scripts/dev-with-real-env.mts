/**
 * Playwright webServer entry: waits for the real-zitadel handshake, then runs
 * the demo-next dev server against that instance/project. Signals forward to
 * the child so Playwright teardown stops Next cleanly.
 */
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { waitForHandshake } from "@zitadel/testing";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(appDir, "../..");
const handshakePath =
  process.env.ZITADEL_TESTING_HANDSHAKE ?? join(appDir, ".zitadel-testing", "handshake.json");

const handle = await waitForHandshake(handshakePath, 180_000);
console.log(`[dev-with-real-env] starting demo-next against ${handle.baseUrl}`);

const child = spawn("corepack", ["pnpm", "--filter", "@zitadel/demo-next", "dev"], {
  cwd: workspaceRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ZITADEL_URL: handle.baseUrl,
    NEXT_PUBLIC_ZITADEL_PROJECT_ID: handle.projectId,
    ZITADEL_PROJECT_SECRET: handle.projectSecret,
  },
});
child.on("exit", (code) => {
  process.exit(code ?? 1);
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => child.kill(signal));
}
