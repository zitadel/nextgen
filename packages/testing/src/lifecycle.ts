import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCli, tail, type RunCliResult } from "./cli";
import {
  describeEnvelopeError,
  parseCliEnvelope,
  type CliEnvelope,
  type StartEnvelopeData,
} from "./envelope";
import { getFreePort } from "./ports";
import type { LocalZitadelRuntime } from "./types";

export interface BootServerOptions {
  /** TCP port for the instance; defaults to an OS-assigned free port. */
  port?: number;
  /**
   * State directory. Defaults to a fresh temp dir that is removed on stop;
   * a caller-provided dir is never removed.
   */
  dir?: string;
  /** Forwarded as ZITADEL_SERVER_BINARY (in-repo runs use dist/server/nextgen). */
  serverBinary?: string;
  /** Keep the owned temp dir after stop (debugging). */
  keep?: boolean;
  /** Test seam: alternative CLI entry script. */
  cliBin?: string;
  timeoutMs?: number;
}

export interface BootedServer {
  baseUrl: string;
  runtime: LocalZitadelRuntime;
  stop(): Promise<void>;
}

/**
 * Boot an ephemeral local server by shelling out to `zitadel start` and parse
 * its JSON envelope. The CLI owns the subtle parts (port preflight, health
 * wait, process-group stop), so this module stays a thin adapter; swapping it
 * for direct library calls later must not change the shape returned here.
 */
export async function bootLocalServer(options: BootServerOptions = {}): Promise<BootedServer> {
  const ownsDir = options.dir === undefined;
  const dir = options.dir ?? (await mkdtemp(join(tmpdir(), "zitadel-testing-")));
  const port = options.port ?? (await getFreePort());
  const env: NodeJS.ProcessEnv = {};
  if (options.serverBinary) {
    env.ZITADEL_SERVER_BINARY = options.serverBinary;
  }

  const result = await runCli({
    args: ["start", "--port", String(port), "--non-interactive", "--json", "-c", dir],
    bin: options.cliBin,
    env,
    timeoutMs: options.timeoutMs,
  });
  if (result.exitCode !== 0) {
    // Keep the dir on failure: server.log inside it is the diagnostic.
    throw new Error(
      `zitadel start exited with code ${result.exitCode}.\n` +
        `${failureDetail(result)}\n` +
        `state dir kept for inspection: ${dir}`,
    );
  }
  const stopViaCli = async (): Promise<void> => {
    const stopResult = await runCli({
      args: ["stop", "--non-interactive", "--json", "-c", dir],
      bin: options.cliBin,
      env,
      timeoutMs: options.timeoutMs,
    });
    if (stopResult.exitCode !== 0) {
      throw new Error(
        `zitadel stop exited with code ${stopResult.exitCode}.\n` +
          `${failureDetail(stopResult)}\n` +
          `state dir kept for inspection: ${dir}`,
      );
    }
  };

  let envelope: CliEnvelope<StartEnvelopeData>;
  try {
    envelope = parseCliEnvelope<StartEnvelopeData>(result.stdout, "zitadel start");
    if (envelope.status !== "ok") {
      throw new Error(
        `zitadel start reported status "${envelope.status}":\n` +
          `${describeEnvelopeError(envelope) ?? tail(result.stdout)}`,
      );
    }
  } catch (error) {
    const startError = new Error(
      `zitadel start produced unusable output.\n` +
        `reason: ${error instanceof Error ? error.message : String(error)}\n` +
        `stdout: ${tail(result.stdout) || "(empty)"}\n` +
        `stderr: ${tail(result.stderr) || "(empty)"}\n` +
        `state dir kept for inspection: ${dir}`,
      { cause: error },
    );
    // start exited 0, so a server may well be running despite the unusable
    // output — stop it instead of orphaning it.
    try {
      await stopViaCli();
    } catch (stopError) {
      // Both errors are preserved in AggregateError.errors, which the rule
      // below cannot model.
      // oxlint-disable-next-line preserve-caught-error
      throw new AggregateError(
        [startError, stopError],
        `${startError.message}\nStopping the possibly-running instance also failed: ${
          stopError instanceof Error ? stopError.message : String(stopError)
        }`,
      );
    }
    throw startError;
  }

  const { runtime, urls } = envelope.data;
  const runStop = async (): Promise<void> => {
    await stopViaCli();
    if (ownsDir && !options.keep) {
      await rm(dir, { recursive: true, force: true });
    }
  };
  // Memoize the in-flight stop so concurrent callers await the same cleanup,
  // and reset on failure so a failed stop can be retried instead of silently
  // leaving the server behind.
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopPromise ??= runStop().catch((error: unknown) => {
      stopPromise = undefined;
      throw error;
    });
    return stopPromise;
  };

  return {
    baseUrl: urls.api,
    runtime: {
      port: runtime.port,
      pid: runtime.pid,
      dir,
      logPath: runtime.log_path,
    },
    stop,
  };
}

/**
 * A failed CLI run usually still prints an error envelope; its
 * message/hint/next_commands beat raw output tails (e.g. a fresh install
 * missing @zitadel/server gets "Reinstall @zitadel/cli" instead of a stack).
 */
function failureDetail(result: RunCliResult): string {
  try {
    const described = describeEnvelopeError(parseCliEnvelope<unknown>(result.stdout, "zitadel"));
    if (described) {
      return described;
    }
  } catch {
    // stdout carried no envelope; fall back to the raw tails.
  }
  return `stdout: ${tail(result.stdout) || "(empty)"}\nstderr: ${tail(result.stderr) || "(empty)"}`;
}
