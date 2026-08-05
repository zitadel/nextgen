import { access } from "node:fs/promises";
import { format } from "node:util";
import { fileURLToPath } from "node:url";

import { run } from "@oclif/core";

export const cliPackageRoot = fileURLToPath(new URL("../../", import.meta.url));

const commandIds = [
  "apply",
  "doctor",
  "eject",
  "logs",
  "plan",
  "reset",
  "setup",
  "start",
  "status",
  "stop",
] as const;

export async function waitForBuiltCli(): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 5000) {
    try {
      await waitForCommandFilesReady();
      await assertOclifDiscoversStatus();
      return;
    } catch (error) {
      lastError = error;
      await delay(50);
    }
  }

  throw new Error(`CLI build was not ready after tsdown completed: ${messageOf(lastError)}`);
}

async function waitForCommandFilesReady(): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 5000) {
    try {
      await assertCommandFilesReady();
      return;
    } catch (error) {
      lastError = error;
      await delay(50);
    }
  }

  throw new Error(`CLI command files were not ready: ${messageOf(lastError)}`);
}

async function assertCommandFilesReady(): Promise<void> {
  await Promise.all(
    commandIds.map((id) =>
      access(fileURLToPath(new URL(`../../dist/commands/${id}.mjs`, import.meta.url))),
    ),
  );
}

async function assertOclifDiscoversStatus(): Promise<void> {
  const { stdout, stderr } = await captureOclifOutput(["commands", "--json"]);
  const commands = JSON.parse(stdout) as Array<{ id?: unknown }>;
  if (!commands.some((command) => command.id === "status")) {
    throw new Error(`oclif did not discover the status command. stderr: ${stderr.trim()}`);
  }
}

async function captureOclifOutput(argv: string[]): Promise<{ stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  const originalLog = console.log;
  const originalConsoleError = console.error;

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

  try {
    await run(argv, cliPackageRoot);
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
    console.log = originalLog;
    console.error = originalConsoleError;
  }

  return { stdout, stderr };
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
