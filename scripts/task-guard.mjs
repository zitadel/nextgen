#!/usr/bin/env node
/**
 * Runs a command under a named lock and/or with retries.
 *
 *   node scripts/task-guard.mjs [--mutex <name>] [--retries <n>] -- <command> [args...]
 *
 * These are the two task options moon provides natively (`mutex`,
 * `retryCount`) and Turborepo does not. Keeping them inside the task's own
 * command makes a task mean the same thing under either runner, which is what
 * the dual-run period in docs/design/build/turborepo-migration.md needs. A
 * task that moon already guards is guarded twice while both runners are
 * configured; the inner guard is uncontended then and costs nothing.
 *
 * The lock is a directory under the OS temp dir, keyed by the repository
 * root, so two checkouts never block each other. The holder's pid is written
 * into it; a lock whose holder is gone is reclaimed. Retries re-run the whole
 * command while the lock is held, which is what a cold-start flake needs: the
 * first attempt warms a cache, the retry runs warm (#1490).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { isDirectRun } from "./dev-process.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const POLL_MS = 250;
const MAX_WAIT_MS = 30 * 60 * 1000;
// A lock directory with no pid file is one whose holder died between creating
// it and writing its pid; give the write this long before reclaiming.
const UNCLAIMED_GRACE_MS = 60 * 1000;

export function parseArgs(argv) {
  const options = { mutex: null, retries: 0, command: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      options.command = argv.slice(i + 1);
      break;
    }
    if (arg === "--mutex" || arg === "--retries") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === "--mutex") {
        if (!/^[a-z0-9-]+$/.test(value)) {
          throw new Error(`--mutex names use lowercase letters, digits and dashes: ${value}`);
        }
        options.mutex = value;
      } else {
        options.retries = Number(value);
        if (!Number.isInteger(options.retries) || options.retries < 0) {
          throw new Error(`--retries takes a non-negative integer: ${value}`);
        }
      }
      i += 1;
      continue;
    }
    throw new Error(
      `unknown argument: ${arg} (usage: task-guard.mjs [--mutex <name>] [--retries <n>] -- <command>)`,
    );
  }
  if (options.command.length === 0) {
    throw new Error("missing command after --");
  }
  return options;
}

export function lockDir(name, root = repoRoot, base = tmpdir()) {
  const key = createHash("sha1").update(root).digest("hex").slice(0, 12);
  return join(base, "zitadel-nextgen-locks", key, `${name}.lock`);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return error.code === "EPERM";
  }
}

function isStale(dir) {
  let pid;
  try {
    pid = Number(readFileSync(join(dir, "pid"), "utf8").trim());
  } catch {
    try {
      return Date.now() - statSync(dir).mtimeMs > UNCLAIMED_GRACE_MS;
    } catch {
      return false;
    }
  }
  return !Number.isInteger(pid) || !isAlive(pid);
}

export async function acquire(dir, { maxWaitMs = MAX_WAIT_MS, log = () => {} } = {}) {
  mkdirSync(join(dir, ".."), { recursive: true });
  const started = Date.now();
  let announced = false;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, "pid"), `${process.pid}\n`);
      return () => rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (isStale(dir)) {
      rmSync(dir, { recursive: true, force: true });
      continue;
    }
    if (!announced) {
      log(`waiting for lock ${dir}`);
      announced = true;
    }
    if (Date.now() - started > maxWaitMs) {
      throw new Error(
        `gave up waiting for lock ${dir} after ${Math.round(maxWaitMs / 60000)} minutes`,
      );
    }
    await sleep(POLL_MS);
  }
}

function runOnce(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { stdio: "inherit" });
    const forward = (signal) => {
      if (child.exitCode === null && !child.killed) child.kill(signal);
    };
    const handlers = ["SIGINT", "SIGTERM"].map((signal) => {
      const handler = () => forward(signal);
      process.on(signal, handler);
      return [signal, handler];
    });
    const done = () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    };
    child.on("error", (error) => {
      done();
      reject(error);
    });
    child.on("exit", (code, signal) => {
      done();
      resolve(signal ? { signal } : { code: code ?? 1 });
    });
  });
}

export async function guard(
  options,
  { log = (line) => console.error(`[task-guard] ${line}`) } = {},
) {
  const release = options.mutex ? await acquire(lockDir(options.mutex), { log }) : () => {};
  const cleanup = () => release();
  process.on("exit", cleanup);
  try {
    const attempts = options.retries + 1;
    for (let attempt = 1; ; attempt += 1) {
      const result = await runOnce(options.command);
      if (result.signal) {
        log(`${options.command[0]} was killed by ${result.signal}`);
        return 1;
      }
      if (result.code === 0 || attempt === attempts) {
        return result.code;
      }
      log(`attempt ${attempt}/${attempts} failed (exit ${result.code}); retrying`);
    }
  } finally {
    process.off("exit", cleanup);
    release();
  }
}

if (isDirectRun(import.meta.url)) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`task-guard: ${error.message}`);
    process.exit(2);
  }
  guard(options).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`task-guard: ${error.message}`);
      process.exit(1);
    },
  );
}
