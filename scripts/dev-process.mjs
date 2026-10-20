import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

// Runs a command with its output captured, then replays it to this process's
// stdout and stderr once it exits. For commands that print a lot (pnpm 12 lists
// every packed file): a pnpm 12 child that shares an inherited, non-blocking
// pipe aborts on EAGAIN when the reader falls behind, where this process's own
// writes retry.
export async function runBuffered(command, args = [], options = {}) {
  try {
    const result = await runCapture(command, args, options);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    return result;
  } catch (error) {
    if (typeof error.stdout === "string") {
      process.stdout.write(error.stdout);
      process.stderr.write(error.stderr);
      error.message = error.message.split("\n")[0];
    }
    throw error;
  }
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
