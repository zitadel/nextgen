/**
 * Waits for the real-instance handshake, then starts the console Vite server
 * with its server-side API proxy bound to the bootstrapped project.
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
console.log(`[console-real-env] starting console against ${handle.baseUrl}`);

const child = spawn("corepack", ["pnpm", "--filter", "@zitadel/console", "dev"], {
  cwd: workspaceRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_CONSOLE_PROJECT_ID: handle.projectId,
    CONSOLE_PROJECT_SECRET: handle.projectSecret,
    CONSOLE_BACKEND_URL: handle.baseUrl,
  },
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => child.kill(signal));
}
