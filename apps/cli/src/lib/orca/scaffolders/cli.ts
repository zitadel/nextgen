import { spawnSync } from "node:child_process";

import { ZitadelError } from "../../errors";
import type { Scaffolder } from "./types";

/**
 * Runs an external command and reports its exit status and stderr. Injected
 * into {@link AbstractCLIScaffolder} so unit tests can assert the command and
 * arguments without spawning a real process; production uses {@link spawnRunner}.
 */
export type CommandRunner = (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
) => { status: number; stderr: string };

/** Production runner: shells out via `spawnSync`, coercing a missing exit to 1. */
const spawnRunner: CommandRunner = (command, args, cwd) => {
  const result = spawnSync(command, [...args], { cwd, encoding: "utf8" });
  return { status: result.status ?? 1, stderr: result.stderr ?? "" };
};

/**
 * Base for scaffolders that delegate to an external CLI (e.g. create-next-app).
 * The command runner is injected so unit tests can assert the exact command and
 * arguments without spawning a real process; production uses {@link spawnRunner}.
 */
export abstract class AbstractCLIScaffolder implements Scaffolder {
  abstract readonly displayName: string;
  abstract readonly supportedFrameworks: ReadonlyArray<string>;

  constructor(private readonly run: CommandRunner = spawnRunner) {}

  /** True when the requested framework is in {@link supportedFrameworks}. */
  canScaffold(framework: string): boolean {
    return this.supportedFrameworks.includes(framework);
  }

  abstract scaffold(cwd: string, framework: string): Promise<void>;

  /**
   * Runs an external command in `cwd`, throwing a typed {@link ZitadelError}
   * on a non-zero exit so the failure surfaces as a categorized CLI error.
   */
  protected runCommand(command: string, args: ReadonlyArray<string>, cwd: string): void {
    const result = this.run(command, args, cwd);
    if (result.status !== 0) {
      throw new ZitadelError(
        "E_VALIDATION",
        `Command "${command} ${args.join(" ")}" exited with status ${String(result.status)}`,
        { details: { stderr: result.stderr } },
      );
    }
  }
}
