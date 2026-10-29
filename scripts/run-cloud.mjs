#!/usr/bin/env node
/**
 * The hosted cloud on localhost: `vercel dev -L` over the repo-root
 * vercel.json, so every service sits behind the deployment's own routes on
 * one origin, http://localhost:3000 (CLOUD_DEV_PORT moves it).
 *
 * `vercel dev` reads vercel.json and nothing else (it ignores
 * --local-config), so what it needs lives there, in fields a deployment does
 * not use:
 *
 * - server: `entrypoint` names apps/cloud/launcher. Vercel's Go builder builds
 *   it in dev and starts it on $PORT; a deployment's build runs
 *   @zitadel/cloud's `deploy` instead, which compiles the same package
 *   through turbo. The launcher, without
 *   CLOUD_DATABASE_URL, serves from SQLite and migrates it at startup.
 * - console: its `devCommand` builds it and serves the build, as the
 *   deployment serves it, behind the same service rewrites. Its dev server
 *   cannot sit behind those rewrites: the console's live loop stays
 *   `moon run console:dev-real`.
 *
 * What only a local run needs comes from here: the builds the dev servers
 * read from disk, a throwaway master key and root admin minted on the first
 * run under .zitadel/local/cloud/, where the SQLite database lives too, and
 * the function compiled without the console (-tags noconsole) as
 * build-launcher.sh compiles it. No Vercel account, link or secret is involved (-L), and Go
 * need not be installed: Vercel's Go builder downloads the version go.mod
 * names.
 */
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { run, runCapture } from "./dev-process.mjs";
import { runnerCommand } from "./task-runner.mjs";

// Pinned: Services is a beta, and what `vercel dev` does with it changes from
// one major to the next. A `vercel` on PATH of the same major is used instead.
const VERCEL_CLI_VERSION = "64.4.0";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const port = process.env.CLOUD_DEV_PORT || "3000";
const origin = `http://localhost:${port}`;
const localDir = join(repoRoot, ".zitadel", "local", "cloud");

try {
  if (!existsSync(join(repoRoot, "node_modules"))) {
    throw new Error(
      "workspace dependencies are not installed: run corepack pnpm install --frozen-lockfile",
    );
  }
  const secrets = await ensureLocalSecrets();
  await buildPrerequisites();
  const env = {
    ...process.env,
    // The workspace install checked above is the one dev needs: without
    // this, `vercel dev` installs again for each service.
    VERCEL_INSTALL_COMPLETED: "1",
    MASTER_KEY_PEM_B64: secrets.masterKeyB64,
    MASTER_KEY_ID: "cloud-local",
    BOOTSTRAP_ADMIN_USER_JSON_B64: secrets.adminUserB64,
    NEXTGEN_SERVER_DATA_DIR: join(localDir, "data"),
    NEXTGEN_SERVER_PUBLIC_BASE: origin,
    NEXTGEN_INSTRUMENTATION_LOG_FORMAT: process.env.NEXTGEN_INSTRUMENTATION_LOG_FORMAT || "text",
    GOFLAGS: [process.env.GOFLAGS, "-tags=noconsole"].filter(Boolean).join(" "),
  };
  console.log(`[cloud] ${origin}/ (website), /docs, /console/`);
  console.log(`[cloud] root admin: ${join(localDir, "admin.json")}`);
  const vercel = await vercelCli();
  console.log(`[cloud] Vercel CLI ${vercel.version} (${vercel.source})`);
  // CLOUD_DEV_DEBUG=1: why a service did not start, which `vercel dev` logs
  // only at debug level.
  const debug = process.env.CLOUD_DEV_DEBUG === "1" ? ["--debug"] : [];
  // `vercel dev` runs the nearest folder above the one it is given that holds
  // a vercel.json, .vercel or .git, if that vercel.json has services. Given
  // the repo root of a desktop-app worktree, which sits in the main
  // checkout's .claude/worktrees/, that is the main checkout; given a folder
  // in the repo root, it is the repo root.
  await runGroup(
    vercel.command,
    [...vercel.args, "dev", join(repoRoot, "scripts"), "-L", "--yes", "--listen", port, ...debug],
    { cwd: repoRoot, env },
  );
} catch (error) {
  console.error(`[cloud] ${error.message}`);
  process.exit(Number.isInteger(error.code) ? error.code : 1);
}

/**
 * The Vercel CLI to drive: the `vercel` on PATH when it is the pinned major,
 * else the pinned version through npx.
 */
async function vercelCli() {
  const installed = await runCapture("vercel", ["--version"], { cwd: repoRoot }).then(
    ({ stdout }) => stdout.trim().split("\n").pop() ?? "",
    () => "",
  );
  if (installed.split(".")[0] === VERCEL_CLI_VERSION.split(".")[0]) {
    return { command: "vercel", args: [], version: installed, source: "on PATH" };
  }
  return {
    command: "npx",
    args: ["--yes", `vercel@${VERCEL_CLI_VERSION}`],
    version: VERCEL_CLI_VERSION,
    source: installed ? `npx; vercel ${installed} on PATH is another major` : "npx",
  };
}

/**
 * Runs `vercel dev` as a process group of its own and passes this script's
 * signals to the whole group. npx does not pass a signal on to the CLI it
 * starts, and the CLI's services outlive it either way, so stopping this
 * script alone would leave them holding the port and .vercel/dev.lock, and
 * the next run would refuse to start.
 *
 * stdin is not passed on. `vercel dev` asks nothing (--yes), and where stdin
 * is a socket that closes, as under the desktop app's preview, every process
 * the CLI starts after it closed fails with `spawn EBADF`.
 */
function runGroup(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "inherit", "inherit"],
      detached: true,
    });
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
    const forward = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The group is already gone.
      }
    };
    for (const signal of signals) {
      process.on(signal, forward);
    }
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      for (const signal of signals) {
        process.off(signal, forward);
      }
      if (code === 0 || signal) {
        resolve();
        return;
      }
      const error = new Error(`vercel dev exited with ${code}`);
      error.code = code;
      reject(error);
    });
  });
}

/**
 * The local deployment's master key and root admin, minted once and kept:
 * the database is wrapped with that key, and the admin document is imported
 * only while its user does not exist.
 */
async function ensureLocalSecrets() {
  mkdirSync(localDir, { recursive: true, mode: 0o700 });
  const keyPath = join(localDir, "master-key.pem");
  if (!existsSync(keyPath)) {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 4096,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    writeFileSync(keyPath, privateKey, { mode: 0o600, flag: "wx" });
    console.log(`[cloud] minted a local master key: ${keyPath}`);
  }
  if (!existsSync(join(localDir, "admin-user.json"))) {
    await run(
      "node",
      [
        join(repoRoot, "apps/cloud/admin-document.mjs"),
        "--email",
        "admin@example.com",
        "--out",
        localDir,
      ],
      { cwd: repoRoot },
    );
  }
  return {
    masterKeyB64: readFileSync(keyPath).toString("base64"),
    adminUserB64: readFileSync(join(localDir, "admin-user.json")).toString("base64"),
  };
}

/**
 * What the services' dev commands read from disk: the packages the console's
 * and the docs' builds import, and the docs' generated sources. Two calls,
 * because under turbo every named task runs in every named package.
 */
async function buildPrerequisites() {
  for (const targets of [
    ["sdk-react:build", "api:build", "api-mock:build", "components:build"],
    ["docs:generate", "design-tokens:generate"],
  ]) {
    const { command, args } = runnerCommand(targets);
    await run(command, args, { cwd: repoRoot });
  }
}
