import { runCli } from "../../src/cli";
import type { CliIO } from "../../src/io/output";

export async function runCliForTest(argv: string[], env: NodeJS.ProcessEnv = {}) {
  let stdout = "";
  let stderr = "";
  const io: CliIO = {
    stdout: { write: (chunk: string | Uint8Array) => ((stdout += String(chunk)), true) },
    stderr: { write: (chunk: string | Uint8Array) => ((stderr += String(chunk)), true) },
    env,
    isTTY: false,
  };
  const exitCode = await runCli(argv, io);
  return { exitCode, stdout, stderr };
}

export function parseJson(stdout: string): unknown {
  return JSON.parse(stdout);
}
