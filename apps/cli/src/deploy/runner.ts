import { spawnSync } from "node:child_process";

import type { CommandRunner } from "./types";

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
