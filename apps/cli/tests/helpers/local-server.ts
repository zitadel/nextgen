import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { onTestFinished } from "vitest";

import { scratchDir } from "./scratch";

/**
 * How the stand-in for the server binary is built. `plain` is the server
 * itself. `orphaned` is a launcher that starts the server as its own child and
 * exits at once (the child is detached from it, or the launcher would wait for
 * it), which leaves the server running with nothing to answer for the pid the CLI
 * recorded, as when a launcher is killed. `logging` is the server, writing
 * {@link LOGGED_LINES} to its log as it starts.
 */
export type ServerShape = "plain" | "orphaned" | "logging";

/** What the `logging` server logs, in the real one's format: a sign-in provider it could not reach, and a failed request. */
export const LOGGED_LINES = {
  info: 'time=2026-10-22T07:58:44.765-07:00 level=INFO msg="server listening for requests" address=:8080',
  warning:
    'time=2026-10-22T07:58:52.102-07:00 level=WARN msg="sso provider unavailable" stream=service project_id=proj_1 slug=acme error="idp.discovery_failed"',
  // The message carries an OSC sequence, because the server's text is the
  // server's: `logs` has to spell it out rather than let it retitle the window.
  error:
    'time=2026-10-22T07:58:52.104-07:00 level=ERROR msg="request failed \u001b]0;pwned\u0007" stream=request request.status_code=500',
} as const;

/** The `logging` server's first statement: it writes {@link LOGGED_LINES} to its log. */
const WRITE_LOGGED_LINES = `process.stderr.write(${JSON.stringify(`${Object.values(LOGGED_LINES).join("\n")}\n`)});
`;

/** The stand-in server, after its `#!` line. */
const PLAIN_SERVER = `const http = require("node:http");
const port = Number((process.env.NEXTGEN_SERVER_ADDRESS || ":8080").split(":").at(-1));
const server = http.createServer((req, res) => {
  res.writeHead(req.url === "/readyz" ? 200 : 404).end("ok");
});
server.listen(port, "localhost");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
`;

/**
 * A stand-in for the server binary, which the CLI starts from the path in `ZITADEL_SERVER_BINARY`.
 * Its directory is removed when the test ends.
 *
 * @param shape - How the stand-in behaves.
 * @returns The path of the executable to start.
 */
export async function aFakeServerBinary(shape: ServerShape): Promise<string> {
  const dir = await scratchDir("zitadel-fake-server-");
  // The run that made this server, so a later run can tell it from one left behind.
  await writeFile(join(dir, "owner"), String(process.pid));
  const server = join(dir, "nextgen");
  await writeFile(
    server,
    `#!/usr/bin/env node\n${shape === "logging" ? WRITE_LOGGED_LINES : ""}${PLAIN_SERVER}`,
  );
  await chmod(server, 0o755);
  if (shape !== "orphaned") {
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

/**
 * Makes sure the local server a test starts in a directory does not outlive the
 * test. The server is found through the directory's own record
 * (`.zitadel/local/runtime.json`) when the test is over, whether or not the start
 * that made it reported success, so a test that fails halfway cannot leak one;
 * the server and its process group are then killed.
 *
 * `onTestFinished` callbacks run in reverse order of registration, so this
 * teardown runs before the removal of a `scratchDir` made earlier. They run after
 * the fixtures are torn down, so the directory must not come from the `dir` fixture:
 * it would be gone before the record is read. Call it after the directory exists, so
 * the record is still there to be read when the server is stopped.
 *
 * @param dir - The directory the test starts a server in.
 */
export function trackLocalServerDir(dir: string): void {
  onTestFinished(async () => {
    const pid = await recordedPid(dir);
    if (pid === undefined) {
      return;
    }
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        // Already gone, which is what was asked for.
      }
    }
  });
}

/**
 * The pid a directory's local server recorded.
 *
 * @param dir - The directory the server was started in.
 * @returns The pid, or `undefined` when there is no readable record.
 */
async function recordedPid(dir: string): Promise<number | undefined> {
  try {
    const record = JSON.parse(await readFile(join(dir, ".zitadel/local/runtime.json"), "utf8"));
    return typeof record.pid === "number" ? record.pid : undefined;
  } catch {
    return undefined;
  }
}
