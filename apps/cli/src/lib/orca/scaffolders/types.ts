import { ZitadelError } from "../../errors";
import { defaultCommandRunner } from "../../../deploy/runner";
import type { CommandRunner } from "../../../deploy/types";

/** Options passed to a scaffolder when creating a new project from scratch. */
export type ScaffoldOptions = Readonly<{
  packageManager?: string;
}>;

/**
 * Creates a brand-new project of a given framework in an (empty) directory.
 * The Orca orchestrator picks the first scaffolder whose {@link canScaffold}
 * returns true. Distinct from a {@link import("../patchers/types").Patcher},
 * which integrates Zitadel into an *existing* project.
 */
export interface Scaffolder {
  /** Human-readable label shown in the framework picker. */
  readonly displayName: string;
  /** Framework identifiers this scaffolder can produce. */
  readonly supportedFrameworks: ReadonlyArray<string>;
  /** Whether this scaffolder can produce the requested framework. */
  canScaffold(framework: string): boolean;
  /** Create the project in `cwd`; the directory must already exist. */
  scaffold(cwd: string, framework: string, opts: ScaffoldOptions): Promise<void>;
}

/**
 * Base for scaffolders that delegate to an external CLI (e.g. create-next-app).
 * The command runner is injected so unit tests can assert the exact command
 * and arguments without spawning a real process; production uses
 * {@link defaultCommandRunner}.
 */
export abstract class AbstractCLIScaffolder implements Scaffolder {
  abstract readonly displayName: string;
  abstract readonly supportedFrameworks: ReadonlyArray<string>;

  constructor(private readonly run: CommandRunner = defaultCommandRunner) {}

  /** True when the requested framework is in {@link supportedFrameworks}. */
  canScaffold(framework: string): boolean {
    return this.supportedFrameworks.includes(framework);
  }

  abstract scaffold(cwd: string, framework: string, opts: ScaffoldOptions): Promise<void>;

  /**
   * Runs an external command in `cwd`, throwing a typed {@link ZitadelError}
   * on a non-zero exit so the failure surfaces as a categorized CLI error.
   */
  protected runCommand(command: string, args: ReadonlyArray<string>, cwd: string): void {
    const result = this.run(command, [...args], { cwd });
    if (result.status !== 0) {
      throw new ZitadelError(
        "E_VALIDATION",
        `Command "${command} ${args.join(" ")}" exited with status ${String(result.status)}`,
        { details: { stderr: result.stderr } },
      );
    }
  }
}
