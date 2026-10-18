import { spawnSync } from "node:child_process";

import { ZitadelError } from "../../errors";
import { reportWarning } from "../../warnings";
import { type NodeEngines, nodeEnginesRange, nodeSupport } from "./node-engines";
import type { Scaffolder } from "./types";

/**
 * Base for scaffolders that delegate to an external CLI (e.g. create-next-app).
 * Subclasses declare the Node the CLI needs in {@link nodeEngines}, implement
 * {@link create} and call {@link runCommand}. {@link scaffold} checks the Node
 * first, for every subclass, so no scaffolder can skip the check.
 */
export abstract class AbstractCLIScaffolder implements Scaffolder {
  abstract readonly displayName: string;
  abstract readonly supportedFrameworks: ReadonlyArray<string>;
  /** The Node the framework CLI this scaffolder runs accepts, and how it treats any other. */
  abstract readonly nodeEngines: NodeEngines;

  private readonly nodeVersion: string;
  private readonly platform: NodeJS.Platform;

  /** `nodeVersion` and `platform` default to the running ones; tests pass others. */
  constructor(
    nodeVersion: string = process.versions.node,
    platform: NodeJS.Platform = process.platform,
  ) {
    this.nodeVersion = nodeVersion;
    this.platform = platform;
  }

  /** True when the requested framework is in {@link supportedFrameworks}. */
  canScaffold(framework: string): boolean {
    return this.supportedFrameworks.includes(framework);
  }

  /**
   * Checks the running Node against the framework CLI's `engines.node`
   * ({@link enforceNodeEngines}), then creates the project ({@link create}).
   */
  async scaffold(cwd: string, framework: string): Promise<void> {
    this.enforceNodeEngines(cwd);
    await this.create(cwd, framework);
  }

  /** Creates the project in `cwd` by running the framework CLI. */
  protected abstract create(cwd: string, framework: string): Promise<void>;

  /**
   * The framework CLI may refuse a Node outside its `engines.node`, which can
   * be narrower than this CLI's own. That refusal would surface as a generic
   * command failure, so the range is checked first ({@link nodeSupport}): a
   * Node the CLI refuses is refused here, naming the versions it needs, and
   * one it only warns about is warned about here too.
   */
  private enforceNodeEngines(cwd: string): void {
    const engines = this.nodeEngines;
    const range = nodeEnginesRange(engines, cwd, this.platform);
    const support = nodeSupport(this.nodeVersion, range, engines.enforcement);
    if (support === "warned") {
      const reason =
        engines.enforcement === "refuse" ? ", as odd-numbered Node versions never reach LTS" : "";
      reportWarning(
        `${engines.label} supports Node ${range}; it runs on Node v${this.nodeVersion} with a warning${reason}`,
      );
    }
    if (support === "refused") {
      throw new ZitadelError(
        "E_VALIDATION",
        `${engines.label} needs Node ${range}; this is Node v${this.nodeVersion}`,
        {
          hint: `Switch to a Node version in that range and rerun, or create the ${this.displayName} app with that Node and run setup inside it.`,
          details: { node: this.nodeVersion, required: range },
        },
      );
    }
  }

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
    if (result.error) {
      const err = result.error as NodeJS.ErrnoException;
      const notFound = err.code === "ENOENT";
      throw new ZitadelError(
        "E_VALIDATION",
        notFound ? `Command not found: ${command}` : `Failed to spawn "${command}": ${err.message}`,
        {
          hint: notFound ? `Ensure '${command}' is installed and on PATH.` : undefined,
          details: { command, args: [...args], code: err.code },
        },
      );
    }
    const status = result.status ?? 1;
    if (status !== 0) {
      const stdout = String(result.stdout ?? "");
      const stderr = String(result.stderr ?? "");
      const output = truncateCommandOutput([stderr, stdout].filter(Boolean).join("\n").trim());
      throw new ZitadelError(
        "E_VALIDATION",
        `Command "${command} ${args.join(" ")}" exited with status ${String(status)}`,
        {
          hint: output ? `Command output:\n${output}` : "Run the command directly for more detail.",
          details: { command, args: [...args], cwd, stdout, stderr },
        },
      );
    }
  }
}

function truncateCommandOutput(output: string): string {
  const limit = 4000;
  if (output.length <= limit) {
    return output;
  }
  return `${output.slice(0, limit)}\n... output truncated ...`;
}
