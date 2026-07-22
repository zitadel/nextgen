/**
 * Playwright webServer entry: boots an ephemeral seeded Zitadel (binary
 * runtime + embedded Postgres) and writes the handshake file that the app
 * dev-server wrapper and the test fixtures read. Stays in the foreground;
 * SIGTERM/SIGINT stop the instance and reap embedded Postgres.
 */
import { access, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startLocalZitadel, writeHandshake, type LocalZitadel } from "@zitadel/testing";

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

let zitadel: LocalZitadel | undefined;
let signalled = false;
let finishing: Promise<void> | undefined;

const finish = (code: number): Promise<void> => {
  finishing ??= (async () => {
    let exitCode = code;
    try {
      await zitadel?.stop();
    } catch (error) {
      console.error(`[real-zitadel] stop failed: ${(error as Error).message}`);
      exitCode = 1;
    }
    await rm(handshakePath, { force: true }).catch(() => undefined);
    process.exit(exitCode);
  })();
  return finishing;
};

// Handlers are installed before the boot so a cancellation arriving while the
// instance comes up (or before the handshake is written) still tears it down.
const onSignal = (signal: NodeJS.Signals): void => {
  signalled = true;
  console.log(
    `[real-zitadel] ${signal} received${zitadel ? ", stopping instance" : " during boot; stopping once ready"}`,
  );
  if (zitadel) {
    void finish(0);
  }
};
process.on("SIGTERM", onSignal);
process.on("SIGINT", onSignal);

await rm(handshakePath, { force: true });

zitadel = await startLocalZitadel({
  port,
  appOrigins: [appOrigin],
  serverBinary,
});
if (signalled) {
  await finish(0);
}

try {
  await writeHandshake(handshakePath, zitadel.handle);
} catch (error) {
  console.error(`[real-zitadel] failed to write handshake: ${(error as Error).message}`);
  await finish(1);
}
console.log(
  `[real-zitadel] instance ready at ${zitadel.handle.baseUrl} (project ${zitadel.handle.projectId})`,
);

setInterval(() => {
  /* keep the event loop alive; Playwright owns this process's lifetime */
}, 60_000);
