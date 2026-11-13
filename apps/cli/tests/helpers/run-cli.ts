import { readFileSync } from "node:fs";
import { format } from "node:util";

import { Command, type Config, run } from "@oclif/core";

import type { LocalServers, ManagedRuntimeProcess } from "@/lib/local-server/processes";
import { publicCliCommand } from "@/lib/public-cli";
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
  const output = captureStreams();
  // Colour is settled for the run rather than inherited: whether the runner
  // was started with `FORCE_COLOR` set, or under a terminal, is nothing to do
  // with the output being asserted. A test that is about colour overlays them
  // itself, and wins.
  const settled: NodeJS.ProcessEnv = { FORCE_COLOR: "", NO_COLOR: "", ...env };
  const overlaid = Object.keys(settled);
  const previous = new Map(overlaid.map((key) => [key, process.env[key]]));
  Object.assign(process.env, settled);

  const exitCode = await commandSeeing(argv[0], machine)
    .then((command) => (command ? command.run(argv.slice(1), root) : run(argv, root)))
    .then(() => 0, exitCodeOf)
    .finally(() => {
      output.restore();
      for (const key of overlaid) {
        const prior = previous.get(key);
        if (prior === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = prior;
        }
      }
    });

  return { exitCode, ...output.read() };
}

/**
 * Starts keeping what the process prints: direct writes to stdout and stderr,
 * and `console.log` and `console.error`, which oclif's `ux` goes through. It is
 * what {@link runCliForTest} reads a run by, for a test that runs a command in
 * process and reads what it said.
 *
 * @returns `read` for what was printed so far and `restore` to print as before.
 */
export function captureStreams(): {
  read(): { stdout: string; stderr: string };
  restore(): void;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  const originalLog = console.log;
  const originalConsoleError = console.error;
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    stderr.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stderr.write;
  console.log = (...args: unknown[]): void => {
    stdout.push(`${format(...args)}\n`);
  };
  console.error = (...args: unknown[]): void => {
    stderr.push(`${format(...args)}\n`);
  };
  return {
    read: () => {
      return { stdout: stdout.join(""), stderr: stderr.join("") };
    },
    restore: () => {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
      console.log = originalLog;
      console.error = originalConsoleError;
    },
  };
}

/**
 * Runs `run` in process and gives back what it printed beside what it returned,
 * for a command built by a test rather than one the built CLI has.
 *
 * @param run - What to run, typically a command's `run`.
 * @returns What `run` returned, and what it printed to stdout and to stderr.
 */
export async function printing<T>(
  run: () => Promise<T>,
): Promise<{ result: T; stdout: string; stderr: string }> {
  const output = captureStreams();
  try {
    const result = await run();
    return { result, ...output.read() };
  } finally {
    output.restore();
  }
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

/** A machine whose processes cannot be listed, as one without `ps` is. */
export function aMachineThatCannotBeRead(): LocalServers {
  return {
    current: () => {
      return Promise.resolve({
        supported: false,
        processes: [],
        error: "spawn ps ENOENT",
      });
    },
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
    const { default: Doctor } = await import("@/commands/doctor");
    return class extends Doctor {
      static override id = "doctor";

      protected override localServers(): LocalServers {
        return machine;
      }
    };
  }
  if (name === "stop") {
    const { default: Stop } = await import("@/commands/stop");
    return class extends Stop {
      static override id = "stop";

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

/**
 * Runs one command class on its own, as the command `id` of the CLI's own
 * package. A run suggests commands by id and renders them from what the loaded
 * CLI declares for that id, and rebuilds itself by its own id, so it needs that
 * config and that id; a class run bare would load the config of whatever
 * started the test runner. The id is set for this run alone and the class is
 * left as the test imported it.
 *
 * @param command - The command class.
 * @param id - The id oclif names it by (`variable:rm`).
 * @param argv - The command line after the command.
 * @returns What the command returned.
 */
export async function runCommand(
  command: new (argv: string[], config: Config) => Command,
  id: string,
  argv: string[],
): Promise<Awaited<ReturnType<typeof Command.run>>> {
  const before = Object.getOwnPropertyDescriptor(command, "id");
  Object.defineProperty(command, "id", { value: id, configurable: true, writable: true });
  try {
    return await Reflect.apply(Command.run, command, [argv, cliPackageRoot]);
  } finally {
    // Put the class back as the test imported it, so a later run of it on its
    // own does not inherit this one's id.
    if (before === undefined) {
      Reflect.deleteProperty(command, "id");
    } else {
      Object.defineProperty(command, "id", before);
    }
  }
}
