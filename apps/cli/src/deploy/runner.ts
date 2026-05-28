import { spawnSync } from "node:child_process";

import type { CommandRunner } from "./types";

/**
 * Production {@link CommandRunner} that shells out via `spawnSync`. Centralized
 * so adapters depend on the {@link CommandRunner} contract rather than
 * `child_process` directly, keeping them unit-testable with stubbed runners.
 * A missing exit status is coerced to `1` so callers can treat it as failure.
 */
export const defaultCommandRunner: CommandRunner = (command, args, opts = {}) => {
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};
