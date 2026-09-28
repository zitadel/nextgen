#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { forwardedArgs, formatCommand, run } from "./dev-process.mjs";
import { assertServerBuildPackage, gitInfo, serverLdflags } from "./server-build.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const args = withServerMigrateArgs(forwardedArgs());
const out = "dist/server/nextgen-debug";

// -gcflags "all=-N -l": disable compiler optimisations (-N) and inlining (-l) so the
// debugger can step through code accurately and inspect local variables.
try {
  await assertServerBuildPackage({ repoRoot });
  const info = await gitInfo({ repoRoot });
  const ldflags = serverLdflags({
    version: `debug+${info.shortCommit}`,
    commit: info.commit,
    date: info.date,
  });
  const buildArgs = ["build", "-gcflags", "all=-N -l", "-ldflags", ldflags, "-o", out, "."];
  if (isHelp(args)) {
    await run("go", ["run", "-ldflags", ldflags, ".", ...helpArgs(args)], { cwd: repoRoot });
  } else {
    process.stderr.write(`\n[server-debug] build: ${formatCommand("go", buildArgs)}\n`);
    process.stderr.write(`[server-debug] run:   ${formatCommand(`./${out}`, args)}\n\n`);
    if (args[0] !== "migrate" && args[0] !== "completion") {
      await run("moon", ["run", "console:build", "login-ui:build"], { cwd: repoRoot });
    }
    await run("go", buildArgs, { cwd: repoRoot });
    await runBinary(`./${out}`, args, repoRoot);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(typeof error === "object" && error !== null && typeof error.code === "number" ? error.code : 1);
}

async function runBinary(command, binaryArgs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, binaryArgs, { cwd, stdio: "inherit" });

    if (child.pid) {
      process.stderr.write(
        `[server-debug] PID ${child.pid} — VSCode: Run ▸ Start Debugging ▸ "Attach to Process"\n`,
      );
    }

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
        resolve();
        return;
      }
      const exitSignal = signal || forwardedSignal;
      const detail = exitSignal ? `signal ${exitSignal}` : `exit ${code}`;
      const error = new Error(`${formatCommand(command, binaryArgs)} failed with ${detail}`);
      error.code = code;
      error.signal = exitSignal;
      reject(error);
    });
  });
}

function isHelp(a) {
  return a.includes("--help") || a.includes("-h") || a[0] === "help";
}

function withServerMigrateArgs(args) {
  if (isHelp(args) || args.includes("--migrate")) {
    return args;
  }
  if (args[0] === "migrate" || args[0] === "completion") {
    return args;
  }
  return [...args, "--migrate"];
}

function helpArgs(a) {
  return a[0] === "help" ? ["--help", ...a.slice(1)] : a;
}
