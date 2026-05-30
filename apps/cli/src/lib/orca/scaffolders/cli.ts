import { spawnSync } from "node:child_process";

import { ZitadelError } from "../../errors";
import type { Scaffolder } from "./types";

/**
 * Base for scaffolders that delegate to an external CLI (e.g. create-next-app).
 * Subclasses implement {@link scaffold} and call {@link runCommand}.
 */
export abstract class AbstractCLIScaffolder implements Scaffolder {
  abstract readonly displayName: string;
  abstract readonly supportedFrameworks: ReadonlyArray<string>;

  /** True when the requested framework is in {@link supportedFrameworks}. */
  canScaffold(framework: string): boolean {
    return this.supportedFrameworks.includes(framework);
  }

  abstract scaffold(cwd: string, framework: string): Promise<void>;

  /**
   * Runs an external command in `cwd`, throwing a typed {@link ZitadelError} on
   * failure so the cause surfaces as a categorized CLI error. Distinguishes
   * "binary not on PATH" (`ENOENT` from the spawn itself) from "binary ran but
   * exited non-zero" — the former previously got masked as a generic
   * `exited with status 1`, leaving users to guess. Tests stub
   * `node:child_process` to assert the command without spawning.
   */
  protected runCommand(command: string, args: ReadonlyArray<string>, cwd: string): void {
    const result = spawnSync(command, [...args], { cwd, encoding: "utf8" });
    // `result.error` is set when the spawn itself failed (e.g. ENOENT for a
    // missing binary). `result.status` is null in that case, so the old
    // `status ?? 1` path reported a confusing generic non-zero exit.
    if (result.error) {
      const err = result.error as NodeJS.ErrnoException;
      const notFound = err.code === "ENOENT";
      throw new ZitadelError(
        "E_VALIDATION",
        notFound
          ? `Command not found: ${command}`
          : `Failed to spawn "${command}": ${err.message}`,
        {
          hint: notFound ? `Ensure '${command}' is installed and on PATH.` : undefined,
          details: { command, args: [...args], code: err.code },
        },
      );
    }
    const status = result.status ?? 1;
    if (status !== 0) {
      throw new ZitadelError(
        "E_VALIDATION",
        `Command "${command} ${args.join(" ")}" exited with status ${String(status)}`,
        { details: { stderr: result.stderr ?? "" } },
      );
    }
  }
}
