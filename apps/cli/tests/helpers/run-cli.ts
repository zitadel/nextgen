import { fileURLToPath } from "node:url";

import { run } from "@oclif/core";

/** Repo root of the CLI package (where the oclif config + built dist live). */
const root = fileURLToPath(new URL("../../", import.meta.url));

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
  const overlaid = Object.keys(env);
  const previous = new Map(overlaid.map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);

  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stderr.write;

  let exitCode = 0;
  try {
    await run(argv, root);
  } catch (error) {
    exitCode = exitCodeOf(error);
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
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
