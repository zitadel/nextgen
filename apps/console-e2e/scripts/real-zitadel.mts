/**
 * Boots the real console test instance and publishes its serializable handle
 * to the console server wrapper and Playwright workers through a handshake.
 */
import { access, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startLocalZitadel, writeHandshake, type LocalZitadel } from "@zitadel/testing";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(appDir, "../..");
const handshakePath =
  process.env.ZITADEL_TESTING_HANDSHAKE ?? join(appDir, ".zitadel-testing", "handshake.json");
const port = Number(process.env.REAL_ZITADEL_PORT ?? 8093);
const appOrigin = process.env.REAL_APP_ORIGIN ?? "http://localhost:5174";
const serverBinary =
  process.env.ZITADEL_SERVER_BINARY ?? join(workspaceRoot, "dist", "server", "nextgen");

await access(serverBinary).catch(() => {
  console.error(
    `[console-real-zitadel] server binary not found at ${serverBinary} — run \`moon run server:build\` first.`,
  );
  process.exit(1);
});

// Signal handlers close over this binding before asynchronous boot assigns it.
// oxlint-disable-next-line prefer-const
let zitadel: LocalZitadel | undefined;
let signalled = false;
let finishing: Promise<void> | undefined;

const finish = (code: number): Promise<void> => {
  finishing ??= (async () => {
    let exitCode = code;
    try {
      await zitadel?.stop();
    } catch (error) {
      console.error(`[console-real-zitadel] stop failed: ${(error as Error).message}`);
      exitCode = 1;
    }
    await rm(handshakePath, { force: true }).catch(() => undefined);
    process.exit(exitCode);
  })();
  return finishing;
};

const onSignal = (signal: NodeJS.Signals): void => {
  signalled = true;
  console.log(
    `[console-real-zitadel] ${signal} received${
      zitadel ? ", stopping instance" : " during boot; stopping once ready"
    }`,
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
  console.error(`[console-real-zitadel] failed to write handshake: ${(error as Error).message}`);
  await finish(1);
}
console.log(
  `[console-real-zitadel] instance ready at ${zitadel.handle.baseUrl} ` +
    `(project ${zitadel.handle.projectId})`,
);

setInterval(() => {
  /* keep the event loop alive; Playwright owns this process's lifetime */
}, 60_000);
