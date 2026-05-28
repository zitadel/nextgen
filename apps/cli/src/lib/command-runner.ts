import { spawnSync } from "node:child_process";

/**
 * Outcome of a single external command invocation. `status` is normalized so a
 * missing exit code is treated as failure (non-zero) by consumers.
 */
export type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

/**
 * Abstraction over running an external command. Injected into the things that
 * shell out (e.g. scaffolders invoking `create-next-app`) so tests can assert
 * the command and arguments without spawning a real process.
 */
export type CommandRunner = (
  command: string,
  args: string[],
  opts?: { cwd?: string; input?: string },
) => CommandResult;

/**
 * Production {@link CommandRunner} that shells out via `spawnSync`. A missing
 * exit status is coerced to `1` so callers can treat it as failure.
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
