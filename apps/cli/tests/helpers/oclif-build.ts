import { access } from "node:fs/promises";
import { format } from "node:util";
import { fileURLToPath } from "node:url";

import { run } from "@oclif/core";
import { z } from "zod";

export const cliPackageRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Built entries (see `tsdown.config.ts`) that must exist before oclif runs. */
const builtEntries = ["index", "lib/oclif/help"] as const;

export async function waitForBuiltCli(): Promise<void> {
  const failure = await retryFor(5000, async () => {
    await waitForCommandFilesReady();
    await assertOclifDiscoversStatus();
  });
  if (failure) {
    throw new Error(`CLI build was not ready after tsdown completed: ${messageOf(failure.error)}`);
  }
}

async function waitForCommandFilesReady(): Promise<void> {
  const failure = await retryFor(5000, assertCommandFilesReady);
  if (failure) {
    throw new Error(`CLI command files were not ready: ${messageOf(failure.error)}`);
  }
}

/** Runs `attempt` until it succeeds or `ms` have passed; the last error if it never did. */
async function retryFor(
  ms: number,
  attempt: () => Promise<void>,
): Promise<{ error: unknown } | undefined> {
  const startedAt = Date.now();
  const poll = async (lastError: unknown): Promise<{ error: unknown } | undefined> => {
    if (Date.now() - startedAt >= ms) {
      return { error: lastError };
    }
    return attempt().then(
      () => undefined,
      async (error: unknown) => {
        await delay(50);
        return poll(error);
      },
    );
  };
  return poll(undefined);
}

async function assertCommandFilesReady(): Promise<void> {
  // The explicit command strategy loads one module, the COMMANDS table, plus
  // the root help class.
  await Promise.all(
    builtEntries.map((entry) =>
      access(fileURLToPath(new URL(`../../dist/${entry}.mjs`, import.meta.url))),
    ),
  );
}

/** What `commands --json` prints, as far as the readiness check reads it. */
const ListedCommands = z.array(
  z.object({
    id: z.unknown().optional(),
  }),
);

/**
 * Fails unless oclif, run against the built CLI, lists the `status` command.
 *
 * @returns Once `status` is listed.
 */
async function assertOclifDiscoversStatus(): Promise<void> {
  const { stdout, stderr } = await captureOclifOutput(["commands", "--json"]);
  const commands = ListedCommands.parse(JSON.parse(stdout));
  const discovered = commands.some((command) => {
    return command.id === "status";
  });
  if (!discovered) {
    throw new Error(`oclif did not discover the status command. stderr: ${stderr.trim()}`);
  }
}

/**
 * Runs oclif in this process and collects what it writes, through the streams
 * or the console. A write takes only its chunk, which fits every overload of
 * `write`, so no cast is needed to stand in for it.
 *
 * @param argv - The command line to run.
 * @returns What it printed on each stream.
 */
async function captureOclifOutput(argv: string[]): Promise<{ stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  const originalLog = console.log;
  const originalConsoleError = console.error;

  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  };
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    stderr.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  };
  console.log = (...args: unknown[]): void => {
    stdout.push(`${format(...args)}\n`);
  };
  console.error = (...args: unknown[]): void => {
    stderr.push(`${format(...args)}\n`);
  };

  try {
    await run(argv, cliPackageRoot);
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
    console.log = originalLog;
    console.error = originalConsoleError;
  }

  return { stdout: stdout.join(""), stderr: stderr.join("") };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
