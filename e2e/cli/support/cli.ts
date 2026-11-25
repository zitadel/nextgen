import { spawn } from "node:child_process";

import { DEFAULT_SERVER } from "@zitadel/config/server";

import { bypassProxyEnv } from "./bypass-proxy";

/**
 * Whether CLOUD_URL is the production domain, the server the CLI targets by
 * default. Each run leaves a project behind in the deployment's database, so
 * the suite skips production; a preview's database is its branch's own.
 */
export function onProductionDomain(): boolean {
  return new URL(process.env.CLOUD_URL ?? "").origin === new URL(DEFAULT_SERVER).origin;
}

/**
 * What the global setup hands the tests, through this variable of the
 * workers' environment: the packed CLI it installed, the directory the run
 * may write to, and the bypass proxy it started, when the deployment needs
 * one. The proxy lives in the runner process, the tests in workers.
 */
export const HARNESS_VARIABLE = "CLI_DEPLOYMENT_HARNESS";

export type Harness = {
  /** The packed CLI's `zitadel` binary. */
  bin: string;
  /** A directory of this run's, outside the repository. */
  dir: string;
  proxy?: { url: string; certPath: string };
};

export function harness(): Harness {
  const value = process.env[HARNESS_VARIABLE];
  if (!value) {
    throw new Error(`${HARNESS_VARIABLE} is unset: run the suite through its Playwright config`);
  }
  return JSON.parse(value) as Harness;
}

/** The JSON envelope every `--json` run prints on stdout. */
export type Envelope = {
  status: "ok" | "skipped" | "error";
  // biome-ignore lint/suspicious/noExplicitAny: each command's own payload
  data?: any;
  reason?: string;
  code?: string;
  message?: string;
  warnings?: string[];
};

export type Exited = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Both streams, to say in a failed assertion what the CLI said. */
  transcript: string;
};

/** A CLI process still running. */
export type Running = {
  /**
   * Resolves with the first text on stdout that matches `pattern`, wherever
   * it sits in its line: a terminal's run prints a link bare, a CI run's
   * behind a `[log]` tag.
   */
  find(pattern: RegExp, timeoutMs?: number): Promise<string>;
  exited(timeoutMs?: number): Promise<Exited>;
};

/**
 * Runs `zitadel <args> --non-interactive --json` in `cwd`, as an agent drives
 * it, and returns the envelope with what the run printed.
 */
export async function zitadel(
  args: string[],
  cwd: string,
): Promise<Envelope & { transcript: string }> {
  const run = await start([...args, "--non-interactive", "--json"], cwd).exited();
  let envelope: Envelope;
  try {
    envelope = JSON.parse(run.stdout);
  } catch {
    throw new Error(`zitadel ${args.join(" ")} printed no JSON envelope\n${run.transcript}`);
  }
  return { ...envelope, transcript: run.transcript };
}

/**
 * Starts `zitadel <args>` in `cwd` and leaves it running. The packed CLI
 * talks to the deployment through the bypass proxy when there is one, and
 * never sees the bypass secret; it sends no telemetry.
 */
export function start(args: string[], cwd: string): Running {
  const { bin, dir, proxy } = harness();
  // Playwright forces colour on its workers; a developer's piped run has none.
  const {
    VERCEL_AUTOMATION_BYPASS_SECRET: _secret,
    FORCE_COLOR: _forceColor,
    ...inherited
  } = process.env;
  const env = proxy ? bypassProxyEnv(proxy, dir, inherited) : inherited;
  const child = spawn(bin, args, {
    cwd,
    env: { ...env, DO_NOT_TRACK: "1", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const transcript = () =>
    `$ zitadel ${args.join(" ")}\n--- stdout\n${stdout}\n--- stderr\n${stderr}`;

  return {
    find: (pattern, timeoutMs = 60_000) =>
      within(
        timeoutMs,
        new Promise((resolve, reject) => {
          const look = () => {
            const found = stdout.match(pattern);
            if (found) {
              child.stdout.off("data", look);
              resolve(found[0]);
            }
          };
          child.stdout.on("data", look);
          look();
          void exit.then(() =>
            reject(new Error(`exited before printing ${pattern}\n${transcript()}`)),
          );
        }),
        () => `nothing matching ${pattern} in ${timeoutMs} ms\n${transcript()}`,
      ),
    exited: async (timeoutMs = 120_000) => {
      const exitCode = await within(timeoutMs, exit, () => {
        child.kill();
        return `still running after ${timeoutMs} ms\n${transcript()}`;
      });
      return { exitCode, stdout, stderr, transcript: transcript() };
    },
  };
}

function within<T>(timeoutMs: number, promise: Promise<T>, message: () => string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message())), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
