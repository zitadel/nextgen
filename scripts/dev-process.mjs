import { spawn } from "node:child_process";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `env` with a PATH on which every process a contributor script starts finds
 * the workspace's tools. The checkout needs only corepack, but package scripts
 * (`pnpm run build`), the CLI's install in a generated app and moon's tasks
 * call a bare `pnpm`: without one on PATH, scripts/shims/pnpm stands in and
 * runs `corepack pnpm`. The workspace's node_modules/.bin goes last, so moon
 * and turbo resolve when the script runs outside `pnpm run` and a global
 * install still wins.
 */
export function withWorkspaceTools(env, options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const isExecutable = options.isExecutable ?? isExecutableFile;
  const entries = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const shimDir = join(repoRoot, "scripts", "shims");
  const binDir = join(repoRoot, "node_modules", ".bin");
  const hasPnpm = entries.some((dir) => isExecutable(join(dir, "pnpm")));
  const path = [
    ...(hasPnpm || entries.includes(shimDir) ? [] : [shimDir]),
    ...entries,
    ...(entries.includes(binDir) ? [] : [binDir]),
  ];
  return { ...env, PATH: path.join(delimiter) };
}

function isExecutableFile(path) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function run(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: options.stdio ?? "inherit",
    });

    const signals = ["SIGINT", "SIGTERM"];
    let forwardedSignal = "";
    const handlers = signals.map((signal) => {
      const handler = () => {
        forwardedSignal = signal;
        if (child.exitCode === null && !child.killed) {
          child.kill(signal);
        }
      };
      process.once(signal, handler);
      return [signal, handler];
    });

    child.on("error", (error) => {
      for (const [signal, handler] of handlers) {
        process.off(signal, handler);
      }
      reject(error);
    });

    child.on("close", (code, signal) => {
      for (const [handledSignal, handler] of handlers) {
        process.off(handledSignal, handler);
      }
      if (code === 0) {
        resolve({ code, signal });
        return;
      }
      const exitSignal = signal || forwardedSignal;
      const detail = exitSignal ? `signal ${exitSignal}` : `exit ${code}`;
      const error = new Error(`${formatCommand(command, args)} failed with ${detail}`);
      error.code = code;
      error.signal = exitSignal;
      reject(error);
    });
  });
}

export function runCapture(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr, code, signal });
        return;
      }
      const detail = signal ? `signal ${signal}` : `exit ${code}`;
      const error = new Error(
        `${formatCommand(command, args)} failed with ${detail}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
      );
      error.code = code;
      error.signal = signal;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

// Runs a command on pipes of its own and replays its output once it exits, for
// commands that run side by side under one task. pnpm 12 is a native binary
// that fails when a write to stdout would block, and a shared pipe turns
// non-blocking for all its writers whenever a Node.js process among them
// touches process.stdout, as every corepack start does (#1786). Settles only
// once the replay is written: release.mjs exits right after a failure, which
// would drop whatever the pipe had not taken yet.
export async function runReplayed(command, args = [], options = {}) {
  let result;
  try {
    result = await runCapture(command, args, options);
  } catch (error) {
    if (typeof error.stdout === "string") {
      await replay(error);
      // runCapture's message repeats the output that was just replayed.
      error.message = error.message.split("\n")[0];
    }
    throw error;
  }
  await replay(result);
  return result;
}

function replay({ stdout, stderr }) {
  return Promise.all([writeAll(process.stdout, stdout), writeAll(process.stderr, stderr)]);
}

// The callback runs once the stream has handed the text to the OS.
function writeAll(stream, text) {
  return new Promise((resolve, reject) => {
    if (!text) {
      resolve();
      return;
    }
    stream.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

export function formatCommand(command, args = []) {
  return [command, ...args].map(shellQuote).join(" ");
}

// Maps items through an async worker with at most `limit` in flight,
// preserving input order in the results. After a failure no new work starts,
// but in-flight workers are awaited (their child processes cannot be
// abandoned safely); the first error is rethrown once all lanes settle.
export async function mapWithConcurrency(items, limit, worker) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`mapWithConcurrency requires a positive integer limit, got ${limit}`);
  }
  const entries = [...items];
  if (entries.length === 0) {
    return [];
  }
  const results = new Array(entries.length);
  const errors = [];
  const width = Math.min(limit, entries.length);
  let next = 0;
  let failed = false;

  await Promise.all(
    Array.from({ length: width }, async () => {
      while (!failed) {
        const index = next;
        next += 1;
        if (index >= entries.length) {
          return;
        }
        try {
          results[index] = await worker(entries[index], index);
        } catch (error) {
          errors.push(error);
          failed = true;
        }
      }
    }),
  );

  if (errors.length > 0) {
    throw errors[0];
  }
  return results;
}

export function forwardedArgs(args = process.argv.slice(2)) {
  return args[0] === "--" ? args.slice(1) : args;
}

// Node loads the entry script from its real path: import.meta.url has every
// symlink resolved, argv[1] keeps the path as given. Compare real paths, or a
// script started through a symlink (macOS's /tmp links to /private/tmp) skips
// its main block and exits 0 having done nothing.
export function isDirectRun(moduleUrl, argv = process.argv) {
  if (!argv[1]) {
    return false;
  }
  try {
    return realpathSync(argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_/:=@.,+%-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
