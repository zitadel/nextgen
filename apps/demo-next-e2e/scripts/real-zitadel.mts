/**
 * Playwright webServer entry: boots an ephemeral seeded Zitadel (binary
 * runtime + embedded Postgres) and writes the handshake file that the app
 * dev-server wrapper and the test fixtures read. Stays in the foreground;
 * SIGTERM/SIGINT stop the instance and reap embedded Postgres.
 */
import { access, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startLocalZitadel, writeHandshake } from "@zitadel/testing";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(appDir, "../..");
const handshakePath =
  process.env.ZITADEL_TESTING_HANDSHAKE ?? join(appDir, ".zitadel-testing", "handshake.json");
const port = Number(process.env.REAL_ZITADEL_PORT ?? 8092);
const appOrigin = process.env.REAL_APP_ORIGIN ?? "http://localhost:3002";
const serverBinary =
  process.env.ZITADEL_SERVER_BINARY ?? join(workspaceRoot, "dist", "server", "nextgen");

// In-repo platform packages ship no binary; fail fast with the fix.
await access(serverBinary).catch(() => {
  console.error(
    `[real-zitadel] server binary not found at ${serverBinary} — run \`moon run server:build\` first.`,
  );
  process.exit(1);
});

await rm(handshakePath, { force: true });

const zitadel = await startLocalZitadel({
  port,
  appOrigins: [appOrigin],
  serverBinary,
});
await writeHandshake(handshakePath, zitadel.handle);
console.log(
  `[real-zitadel] instance ready at ${zitadel.handle.baseUrl} (project ${zitadel.handle.projectId})`,
);

let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[real-zitadel] ${signal} received, stopping instance`);
  void zitadel
    .stop()
    .catch((error: unknown) => {
      console.error(`[real-zitadel] stop failed: ${(error as Error).message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await rm(handshakePath, { force: true });
      process.exit();
    });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

setInterval(() => {
  /* keep the event loop alive; Playwright owns this process's lifetime */
}, 60_000);
