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
   * a non-zero (or missing) exit so the failure surfaces as a categorized CLI
   * error. Tests stub `node:child_process` to assert the command without spawning.
   */
  protected runCommand(command: string, args: ReadonlyArray<string>, cwd: string): void {
    const result = spawnSync(command, [...args], { cwd, encoding: "utf8" });
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
