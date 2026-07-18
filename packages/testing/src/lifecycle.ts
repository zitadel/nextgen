import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCli, tail } from "./cli";
import { parseCliEnvelope, type StartEnvelopeData } from "./envelope";
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
 * wait, process-group stop, embedded-Postgres reaping), so this module stays a
 * thin adapter; swapping it for direct library calls later must not change the
 * shape returned here.
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
        `stdout: ${tail(result.stdout) || "(empty)"}\n` +
        `stderr: ${tail(result.stderr) || "(empty)"}\n` +
        `state dir kept for inspection: ${dir}`,
    );
  }
  const envelope = parseCliEnvelope<StartEnvelopeData>(result.stdout, "zitadel start");
  if (envelope.status !== "ok") {
    throw new Error(`zitadel start reported status "${envelope.status}":\n${tail(result.stdout)}`);
  }

  const { runtime, urls } = envelope.data;
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    stopped = true;
    const stopResult = await runCli({
      args: ["stop", "--non-interactive", "--json", "-c", dir],
      bin: options.cliBin,
      env,
      timeoutMs: options.timeoutMs,
    });
    if (stopResult.exitCode !== 0) {
      throw new Error(
        `zitadel stop exited with code ${stopResult.exitCode}.\n` +
          `stdout: ${tail(stopResult.stdout) || "(empty)"}\n` +
          `stderr: ${tail(stopResult.stderr) || "(empty)"}\n` +
          `state dir kept for inspection: ${dir}`,
      );
    }
    if (ownsDir && !options.keep) {
      await rm(dir, { recursive: true, force: true });
    }
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
