import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach } from "vitest";

/**
 * How the stand-in for the server binary is built. `plain` is the server
 * itself. `orphaned` is a launcher that starts the server as its own child and
 * exits at once (the child is detached from it, or the launcher would wait for
 * it), which leaves the server running with nothing to answer for the pid the CLI
 * recorded, as when a launcher is killed.
 */
export type ServerShape = "plain" | "orphaned";

const PLAIN_SERVER = `#!/usr/bin/env node
const http = require("node:http");
const port = Number((process.env.NEXTGEN_SERVER_ADDRESS || ":8080").split(":").at(-1));
const server = http.createServer((req, res) => {
  res.writeHead(req.url === "/healthz" ? 200 : 404).end("ok");
});
server.listen(port, "localhost");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
`;

const startedPids: number[] = [];
const startedDirs: string[] = [];

/** A stand-in for the server binary, which the CLI starts from the path in `ZITADEL_SERVER_BINARY`. */
export async function aFakeServerBinary(shape: ServerShape): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-fake-server-"));
  const server = join(dir, "nextgen");
  await writeFile(server, PLAIN_SERVER);
  await chmod(server, 0o755);
  if (shape === "plain") {
    return server;
  }
  const launcher = join(dir, "launcher");
  await writeFile(
    launcher,
    `#!/usr/bin/env node
require("node:child_process")
  .spawn(${JSON.stringify(server)}, [], { stdio: "ignore", env: process.env })
  .unref();
`,
  );
  await chmod(launcher, 0o755);
  return launcher;
}

/** Remembers a server a test started by its pid, so that none outlives the test. */
export function trackLocalServer(pid: number): void {
  startedPids.push(pid);
}

/**
 * Remembers a directory a test started a server in. The server is found through
 * the directory's own record when the test is over, whether or not the start
 * that made it reported success, so a test that fails halfway cannot leak one.
 */
export function trackLocalServerDir(dir: string): void {
  startedDirs.push(dir);
}

/** Stops every local server the tests started, once each test is over. */
export function useLocalServers(): void {
  afterEach(async () => {
    const pids = startedPids.splice(0);
    for (const dir of startedDirs.splice(0)) {
      const pid = await recordedPid(dir);
      if (pid !== undefined) {
        pids.push(pid);
      }
    }
    for (const pid of pids) {
      for (const target of [-pid, pid]) {
        try {
          process.kill(target, "SIGKILL");
        } catch {}
      }
    }
  });
}

async function recordedPid(dir: string): Promise<number | undefined> {
  try {
    const record = JSON.parse(await readFile(join(dir, ".zitadel/local/runtime.json"), "utf8"));
    return typeof record.pid === "number" ? record.pid : undefined;
  } catch {
    return undefined;
  }
}
