import { readFileSync } from "node:fs";
import { format } from "node:util";

import { run } from "@oclif/core";

import { publicCliCommand } from "../../src/lib/public-cli";
import { cliPackageRoot } from "./oclif-build";

const cliVersion = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

/**
 * Runs the built oclif CLI in-process, capturing stdout/stderr and the exit
 * code, with `env` overlaid onto `process.env` for the duration. Mirrors a real
 * `zitadel <args>` invocation; the JSON envelope is emitted by the domain
 * `run*` functions to stdout exactly as in production. Requires the CLI to have
 * been built (vitest global setup builds `dist/commands`).
 */
export async function runCliForTest(argv: string[], env: NodeJS.ProcessEnv = {}) {
  let stdout = "";
  let stderr = "";
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  const originalLog = console.log;
  const originalConsoleError = console.error;
  const overlaid = Object.keys(env);
  const previous = new Map(overlaid.map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);

  // Capture both direct stream writes (e.g. consola) and oclif's `ux.stdout`/
  // `ux.stderr`, which go through `console.log`/`console.error`.
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stderr.write;
  console.log = (...args: unknown[]): void => {
    stdout += `${format(...args)}\n`;
  };
  console.error = (...args: unknown[]): void => {
    stderr += `${format(...args)}\n`;
  };

  let exitCode = 0;
  try {
    await run(argv, cliPackageRoot);
  } catch (error) {
    exitCode = exitCodeOf(error);
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
    console.log = originalLog;
    console.error = originalConsoleError;
    for (const key of overlaid) {
      const prior = previous.get(key);
      if (prior === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prior;
      }
    }
  }

  return { exitCode, stdout, stderr };
}

function exitCodeOf(error: unknown): number {
  const candidate = error as { oclif?: { exit?: number }; exitCode?: number } | null;
  if (candidate && typeof candidate.oclif?.exit === "number") {
    return candidate.oclif.exit;
  }
  if (candidate && typeof candidate.exitCode === "number") {
    return candidate.exitCode;
  }
  return 1;
}

export function parseJson(stdout: string): unknown {
  return JSON.parse(stdout);
}

export function expectedPublicCliCommand(args: string): string {
  return publicCliCommand(args, cliVersion.version);
}
