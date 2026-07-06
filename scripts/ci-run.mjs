#!/usr/bin/env node
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { formatCommand, forwardedArgs } from "./dev-process.mjs";

const args = forwardedArgs();
const separator = args.indexOf("--");

if (args.includes("--help") || args.includes("-h")) {
  usage();
}

if (separator === -1 || separator === args.length - 1) {
  usage("missing command after --");
}

const options = parseOptions(args.slice(0, separator));
const command = args[separator + 1];
const commandArgs = args.slice(separator + 2);
const diagnosticsDir = process.env.CI_DIAGNOSTICS_DIR || join(process.cwd(), "dist", "ci-diagnostics");
const logFile = `logs/${options.id}.log`;
const stepFile = join(diagnosticsDir, "steps", `${options.id}.json`);
const startedAt = new Date();

await mkdir(join(diagnosticsDir, "logs"), { recursive: true });
await mkdir(join(diagnosticsDir, "steps"), { recursive: true });

const result = await runAndTee({
  command,
  args: commandArgs,
  logPath: join(diagnosticsDir, logFile),
});
const finishedAt = new Date();
const status = result.code === 0 && !result.signal && !result.error ? "passed" : "failed";

await writeFile(
  stepFile,
  `${JSON.stringify(
    {
      id: options.id,
      name: options.name,
      command: formatCommand(command, commandArgs),
      rerun: options.rerun || formatCommand(command, commandArgs),
      status,
      exitCode: result.code,
      signal: result.signal,
      error: result.error?.message,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      logFile,
    },
    null,
    2,
  )}\n`,
);

if (result.error) {
  console.error(result.error.message);
}

if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.code ?? (result.error ? 1 : 0));
}

function parseOptions(values) {
  const parsed = { id: "", name: "", rerun: "" };
  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    switch (arg) {
      case "--id":
        parsed.id = values[++index] ?? "";
        break;
      case "--name":
        parsed.name = values[++index] ?? "";
        break;
      case "--rerun":
        parsed.rerun = values[++index] ?? "";
        break;
      default:
        usage(`unknown option: ${arg}`);
    }
  }

  if (!parsed.id) {
    usage("--id is required");
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(parsed.id)) {
    usage("--id may only contain letters, numbers, underscore, dot, and dash");
  }
  if (!parsed.name) {
    parsed.name = parsed.id;
  }
  return parsed;
}

function runAndTee(input) {
  return new Promise((resolve) => {
    const log = createWriteStream(input.logPath, { flags: "a" });
    const child = spawn(input.command, input.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const signals = ["SIGINT", "SIGTERM"];
    const handlers = signals.map((signal) => {
      const handler = () => {
        if (child.exitCode === null && !child.killed) {
          child.kill(signal);
        }
      };
      process.once(signal, handler);
      return [signal, handler];
    });

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      for (const [signal, handler] of handlers) {
        process.off(signal, handler);
      }
      log.end(() => resolve(result));
    };

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      log.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      log.write(chunk);
    });
    child.on("error", (error) => {
      log.write(`${error.message}\n`);
      finish({ code: 1, signal: null, error });
    });
    child.on("close", (code, signal) => {
      finish({ code, signal, error: null });
    });
  });
}

function usage(error) {
  if (error) {
    console.error(error);
    console.error("");
  }
  console.log(`usage: node scripts/ci-run.mjs --id <id> [--name <label>] [--rerun <command>] -- <command> [args...]

Runs a CI phase, tees output into CI_DIAGNOSTICS_DIR/logs/<id>.log, and writes
structured step metadata for the final CI diagnostics summary.`);
  process.exit(error ? 1 : 0);
}
