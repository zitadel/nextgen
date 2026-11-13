#!/usr/bin/env node
// Starts a server binary the way a user runs a release — `nextgen --migrate`
// on an empty data dir, nothing else configured — waits until /readyz answers
// 200 and stops it again.
//
//   node scripts/smoke-server.mjs [binary]
//
// Without an argument it runs this host's release binary: the bin/ of its
// platform package (apps/server-<platform>), which that package's
// build-binary task writes. The nightly artifacts workflow
// (.github/workflows/artifacts.yml) runs it on macOS and Linux with the
// binaries one Linux job cross-compiled. It does not run on Windows.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { isDirectRun } from "./dev-process.mjs";
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

/** Start, health check, stop: the whole smoke of one binary. */
export async function smokeServer({ binary = hostReleaseBinary() } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "nextgen-smoke-"));
  try {
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
    return { binary, readyMs, exit: result };
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

if (isDirectRun(import.meta.url)) {
  try {
    const arg = process.argv[2];
    const { binary, readyMs, exit } = await smokeServer(arg ? { binary: resolve(arg) } : {});
    process.stderr.write(
      `[smoke-server] ${binary}: /readyz 200 after ${readyMs} ms; stopped (code ${exit.code}, signal ${exit.signal})\n`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
