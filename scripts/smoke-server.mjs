#!/usr/bin/env node
// Starts a server binary the way a user runs a release — `nextgen --migrate`
// on an empty data dir, nothing else configured — waits until /readyz answers
// 200 and stops it again.
//
//   node scripts/smoke-server.mjs [binary]
//   node scripts/smoke-server.mjs --version <published version>
//
// Without an argument it runs this host's release binary: the bin/ of its
// platform package (apps/server-<platform>), which that package's
// build-binary task writes. With --version it installs that release of
// @zitadel/server from npm, as a customer does, and starts the binary the
// package resolves for this host (`@zitadel/server/binary`, what the CLI
// uses); the server must report that version. An empty --version is the
// same as none. The artifacts workflow (.github/workflows/artifacts.yml) runs
// it on macOS and Linux. It does not run on Windows.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { isDirectRun, run, runCapture } from "./dev-process.mjs";
import { SERVER_PLATFORM_PACKAGES } from "./release-manifest.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** This host's release binary, in its platform package's bin/. */
export function hostReleaseBinary(platform = process.platform, arch = process.arch) {
  const entry = SERVER_PLATFORM_PACKAGES.find(
    (candidate) => candidate.packageName === `@zitadel/server-${platform}-${arch}`,
  );
  if (!entry || platform === "win32") {
    throw new Error(`no server release binary to smoke for ${platform}/${arch}`);
  }
  return join(repoRoot, entry.packageDir, "bin", "nextgen");
}

/**
 * Installs @zitadel/server@<version> from npm into `dir` the way a customer
 * does, and returns the binary that release resolves for this host: its
 * `@zitadel/server/binary` export finds the platform package npm installed
 * as an optional dependency, as the CLI does.
 */
export async function installPublishedServer(version, dir) {
  await run(
    "npm",
    ["install", "--prefix", dir, "--no-audit", "--no-fund", `@zitadel/server@${version}`],
    { cwd: dir },
  );
  // runCapture throws with the output when the resolution fails.
  const resolved = await runCapture(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'console.log((await import("@zitadel/server/binary")).resolveServerBinary())',
    ],
    { cwd: dir },
  );
  return resolved.stdout.trim();
}

async function freePort() {
  const server = createServer();
  await new Promise((done, fail) => server.once("error", fail).listen(0, "127.0.0.1", done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

/**
 * Runs `binary` with `args` on `dataDir` and resolves once it has exited,
 * with its exit code and output. For one-shot commands such as `migrate`.
 */
export async function runServerCommand({ binary, dataDir, args, env = {} }) {
  const child = spawn(binary, args, {
    env: { ...process.env, NEXTGEN_SERVER_DATA_DIR: dataDir, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const [code, signal] = await new Promise((done, fail) =>
    child.once("error", fail).once("exit", (...exit) => done(exit)),
  );
  return { code, signal, output };
}

/**
 * Starts `binary --migrate` on `dataDir`, listening on a free loopback port,
 * and resolves once GET /readyz answers 200. `stop()` sends SIGTERM and
 * resolves with the exit.
 */
export async function startServer({ binary, dataDir, env = {}, timeoutMs = 120_000 }) {
  if (!existsSync(binary)) throw new Error(`no server binary at ${binary}`);
  // A downloaded artifact loses its mode bits.
  chmodSync(binary, 0o755);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(binary, ["--migrate"], {
    env: {
      ...process.env,
      NEXTGEN_SERVER_ADDRESS: `127.0.0.1:${port}`,
      NEXTGEN_SERVER_PUBLIC_BASE: url,
      NEXTGEN_SERVER_DATA_DIR: dataDir,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  let exited = null;
  const exit = new Promise((done) => {
    child.once("error", (error) => {
      exited = { code: null, signal: null, error };
      done(exited);
    });
    child.once("exit", (code, signal) => {
      exited = { code, signal };
      done(exited);
    });
  });

  const stop = async () => {
    if (!exited) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
      await exit;
      clearTimeout(timer);
    }
    return { ...exited, output };
  };

  const deadline = Date.now() + timeoutMs;
  let status = 0;
  while (Date.now() < deadline && !exited) {
    status = await fetch(`${url}/readyz`)
      .then((response) => response.status)
      .catch(() => 0);
    if (status === 200) return { url, port, stop, output: () => output };
    await delay(500);
  }
  await stop();
  const reason = exited?.error
    ? `could not start: ${exited.error.message}`
    : exited && (exited.code !== null || exited.signal)
      ? `exited (code ${exited.code}, signal ${exited.signal}) before /readyz answered`
      : `/readyz answered ${status} after ${timeoutMs / 1000}s`;
  throw new Error(`${binary} ${reason}:\n${output}`);
}

/**
 * Start, health check, stop: the whole smoke of one binary, or of the
 * published release `version`.
 */
export async function smokeServer({ binary, version } = {}) {
  const work = mkdtempSync(join(tmpdir(), "nextgen-smoke-"));
  const dataDir = join(work, "data");
  try {
    if (version) {
      const install = join(work, "install");
      mkdirSync(install);
      binary = await installPublishedServer(version, install);
    }
    binary ??= hostReleaseBinary();
    const started = Date.now();
    const server = await startServer({ binary, dataDir });
    const readyMs = Date.now() - started;
    const result = await server.stop();
    // The server exits 0 on SIGTERM; a SIGTERM exit is clean too.
    if (result.code !== 0 && result.signal !== "SIGTERM") {
      throw new Error(
        `${binary} did not stop cleanly (code ${result.code}, signal ${result.signal}):\n${result.output}`,
      );
    }
    // The server logs its version with every record (text or JSON format).
    if (
      version &&
      !result.output.includes(`version=${version} `) &&
      !result.output.includes(`"version":"${version}"`)
    ) {
      throw new Error(`${binary} did not report version ${version}:\n${result.output}`);
    }
    return { binary, readyMs, exit: result };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (isDirectRun(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: { version: { type: "string" } },
    });
    const { binary, readyMs, exit } = await smokeServer({
      binary: positionals[0] ? resolve(positionals[0]) : undefined,
      version: values.version || undefined,
    });
    process.stderr.write(
      `[smoke-server] ${binary}: /readyz 200 after ${readyMs} ms; stopped (code ${exit.code}, signal ${exit.signal})\n`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
