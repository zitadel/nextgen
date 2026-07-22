import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export interface RunCliOptions {
  args: string[];
  env?: NodeJS.ProcessEnv;
  /** Test seam / escape hatch: alternative CLI entry script. */
  bin?: string;
  timeoutMs?: number;
}

export interface RunCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export function resolveCliBin(): string {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("@zitadel/cli/package.json");
  const pkg = require(pkgPath) as { bin?: Record<string, string> };
  const rel = pkg.bin?.zitadel;
  if (!rel) {
    throw new Error("@zitadel/cli does not declare a `zitadel` bin entry");
  }
  return join(dirname(pkgPath), rel);
}

export function runCli(options: RunCliOptions): Promise<RunCliResult> {
  const bin = options.bin ?? resolveCliBin();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...options.args], {
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `zitadel ${options.args[0] ?? ""} timed out after ${timeoutMs}ms\n${tail(stderr)}`,
        ),
      );
    }, timeoutMs);
    timer.unref();
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

export function tail(text: string, lines = 20): string {
  return text.split("\n").slice(-lines).join("\n").trim();
}
