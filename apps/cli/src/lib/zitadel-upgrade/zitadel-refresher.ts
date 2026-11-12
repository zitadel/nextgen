import { execa } from "execa";

import { hasZitadelConfig } from "@/lib/project";
import type { Refresher, RefreshOutcome } from "@/lib/upgrade";

import { UPDATE_CHECK_VARIABLE, ZITADEL } from "./zitadel";

const REFRESH_TIMEOUT_MS = 5 * 60 * 1000;

/** What a {@link ZitadelRefresher} is given. */
export type ZitadelRefresherOptions = Readonly<{
  cwd: string;
  env: NodeJS.ProcessEnv;
  noTelemetry: boolean;
  signal: AbortSignal;
}>;

/** Has the new Zitadel CLI regenerate a project's files with its `doctor --fix`. */
export class ZitadelRefresher implements Refresher {
  /** What the run was given. */
  private readonly options: ZitadelRefresherOptions;

  /**
   * @param options.cwd - The project directory.
   * @param options.env - The run's environment.
   * @param options.noTelemetry - `--no-telemetry` was given: it reaches this run only, not the child, without being passed on.
   * @param options.signal - Ctrl-C: it ends the child and the upgrade with it, rather than a refresh that merely failed.
   */
  constructor(options: ZitadelRefresherOptions) {
    this.options = options;
  }

  /** Whether the project has a Zitadel config for the new release to regenerate around. */
  async appliesTo(): Promise<boolean> {
    return hasZitadelConfig(this.options.cwd);
  }

  /**
   * Runs the new release's `doctor --fix`, as a child whose one envelope is
   * captured: it must not print into this command's output. It repairs and then
   * verifies, so a run that reports issues still repaired what it could; the new
   * packages stay either way.
   *
   * @param version - The release to run.
   * @throws The signal's reason when the run was interrupted.
   */
  async refresh(version: string): Promise<RefreshOutcome> {
    const { cwd, env, noTelemetry, signal } = this.options;
    try {
      const result = await execa(
        "npx",
        [
          "--yes",
          `${ZITADEL.packageName}@${version}`,
          "doctor",
          "--fix",
          "--non-interactive",
          "--json",
          ...(noTelemetry ? ["--no-telemetry"] : []),
        ],
        {
          cwd,
          env: {
            ...env,
            [UPDATE_CHECK_VARIABLE]: "0",
          },
          extendEnv: false,
          reject: false,
          stdin: "ignore",
          timeout: REFRESH_TIMEOUT_MS,
          cancelSignal: signal,
        },
      );
      signal.throwIfAborted();
      const envelope = JSON.parse(result.stdout) as { status?: unknown };
      return envelope.status === "ok" ? "done" : "issues";
    } catch {
      signal.throwIfAborted();
      return "failed";
    }
  }
}
