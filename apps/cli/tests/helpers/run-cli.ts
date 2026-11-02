import { readFileSync } from "node:fs";
import { format } from "node:util";

import { run } from "@oclif/core";

import type { LocalServers, ManagedRuntimeProcess } from "../../src/lib/local-server/processes";
import { publicCliCommand } from "../../src/lib/public-cli";
import { cliPackageRoot } from "./oclif-build";

export const cliVersion = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

/**
 * Runs the built oclif CLI in-process, capturing stdout/stderr and the exit
 * code, with `env` overlaid onto `process.env` for the duration. Mirrors a real
 * `zitadel <args>` invocation; the JSON envelope is emitted by the domain
 * `run*` functions to stdout exactly as in production. Requires the CLI to have
 * been built (vitest global setup builds `dist/index.mjs`). `root` is the
 * package oclif loads; pass a staged copy to exercise a published layout.
 *
 * `doctor` and `stop` run from the source with `machine` as the servers the
 * machine runs, none unless a test gives some, so no run reads the host's
 * processes and a Zitadel running on the developer's machine changes no result.
 */
export async function runCliForTest(
  argv: string[],
  env: NodeJS.ProcessEnv = {},
  root: string = cliPackageRoot,
  machine: LocalServers = aMachineRunning(),
) {
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
    const command = await commandSeeing(argv[0], machine);
    await (command ? command.run(argv.slice(1), root) : run(argv, root));
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

/** A machine that runs exactly the given servers, whatever it really runs. */
export function aMachineRunning(
  ...processes: ReadonlyArray<Omit<ManagedRuntimeProcess, "kind">>
): LocalServers {
  return {
    current: () =>
      Promise.resolve({
        supported: true,
        processes: processes.map((entry) => ({ ...entry, kind: "server-wrapper" as const })),
      }),
  };
}

/** The source command that asks `machine` which servers run, for the commands that ask. */
async function commandSeeing(
  name: string | undefined,
  machine: LocalServers,
): Promise<{ run(argv: string[], root: string): Promise<unknown> } | undefined> {
  // Loaded here, not at the top: this module is loaded by the test setup, ahead
  // of any test's mocks, and the commands must not be.
  if (name === "doctor") {
    const { default: Doctor } = await import("../../src/commands/doctor");
    return class extends Doctor {
      protected override localServers(): LocalServers {
        return machine;
      }
    };
  }
  if (name === "stop") {
    const { default: Stop } = await import("../../src/commands/stop");
    return class extends Stop {
      protected override localServers(): LocalServers {
        return machine;
      }
    };
  }
  return undefined;
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

// Spelled as an escape so the pattern carries no literal control character.
const ESC = "\\u001B";
const ANSI_SEQUENCE = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

/** Drops SGR colour codes so assertions can target the text itself. */
export function stripAnsi(text: string): string {
  return text.replaceAll(ANSI_SEQUENCE, "");
}

export function expectedPublicCliCommand(args: string): string {
  return publicCliCommand(args, cliVersion.version);
}

/**
 * Presses Ctrl-C in the running command. Emitting the signal rather than
 * sending it keeps the keypress inside this process, where the command runs.
 */
export function pressCtrlC(): void {
  process.emit("SIGINT", "SIGINT");
}
