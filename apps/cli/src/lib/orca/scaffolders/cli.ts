import { mkdir, readdir, rename, rmdir } from "@/lib/fs";
import { basename, join } from "node:path";
import { execaSync } from "execa";

import {
  OrcaCommandFailedError,
  OrcaCommandNotFoundError,
  OrcaCommandSpawnFailedError,
  OrcaNodeUnsupportedError,
} from "@/lib/orca/errors";
import { warnings } from "@/lib/ui";

import {
  describeAcceptedNode,
  type NodeEngines,
  nodeEnginesRange,
  nodeSupport,
} from "./node-engines";
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
  /**
   * The packages a fresh app gets at an exact version because this scaffolder
   * pins them, as `name@version`: the framework CLI (`framework-clis.ts`) and
   * any package that release writes at a fixed version. The ranges it writes
   * move to patched releases by themselves; a pin stays on its version until
   * a bump merges, so `@zitadel/cli#check-advisories` checks each against the
   * npm advisory database.
   */
  readonly pinnedPackages: ReadonlyArray<string> = [];
  /**
   * Whether the framework CLI names the app after the folder it runs in and
   * refuses a folder name npm does not accept as a package name. When true and
   * the folder's name is not one, {@link scaffold} creates the app in a
   * subfolder with a valid name and moves it up.
   */
  protected readonly requiresValidFolderName: boolean = true;

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
    if (this.requiresValidFolderName && npmPackageNameErrors(basename(cwd)).length > 0) {
      await this.createInSubfolder(cwd, framework);
      return;
    }
    await this.create(cwd, framework);
  }

  /** Creates the project in `cwd` by running the framework CLI. */
  protected abstract create(cwd: string, framework: string): Promise<void>;

  /**
   * Creates the project in a subfolder of `cwd` named as a valid package name
   * (the folder's name, lowercased, with each run of other characters as one
   * `-`, cut to npm's 214 characters; `app` when nothing is left), then moves
   * its entries up into `cwd`.
   * The subfolder is renamed first because the project may have an entry of
   * the same name (`app`, `src`), which would otherwise land inside itself.
   */
  private async createInSubfolder(cwd: string, framework: string): Promise<void> {
    const name =
      basename(cwd)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 214)
        .replace(/^-+|-+$/g, "") || "app";
    const subfolder = join(cwd, name);
    await mkdir(subfolder);
    await this.create(subfolder, framework);
    const moving = join(cwd, `.${name}.moving`);
    await rename(subfolder, moving);
    for (const entry of await readdir(moving)) {
      await rename(join(moving, entry), join(cwd, entry));
    }
    await rmdir(moving);
  }

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
      warnings.report(
        `${engines.label} supports Node ${range}; it runs on Node v${this.nodeVersion} with a warning${reason}`,
      );
    }
    if (support === "refused") {
      throw new OrcaNodeUnsupportedError(
        `${engines.label} needs Node ${range}; this is Node v${this.nodeVersion}`,
        this.nodeVersion,
        range,
        describeAcceptedNode(range),
        this.displayName,
      );
    }
  }

  /**
   * Runs an external command in `cwd`, throwing a typed {@link OrcaError} on
   * failure. Distinguishes "binary not on PATH" (`ENOENT` from the spawn
   * itself) from "binary ran but exited non-zero" — the former is not masked
   * as a generic `exited with status 1`, which would leave users to guess.
   * Tests stub `execa` to assert the command without spawning.
   */
  protected runCommand(command: string, args: ReadonlyArray<string>, cwd: string): void {
    const result = execaSync(command, [...args], { cwd, reject: false });
    if (result.code !== undefined) {
      if (result.code === "ENOENT") {
        throw new OrcaCommandNotFoundError(
          `Command not found: ${command}`,
          command,
          args,
          result.code,
        );
      }
      throw new OrcaCommandSpawnFailedError(
        `Failed to spawn "${command}": ${result.originalMessage ?? result.message}`,
        command,
        args,
        result.code,
      );
    }
    const status = result.exitCode ?? 1;
    if (status !== 0) {
      const stdout = String(result.stdout);
      const stderr = String(result.stderr);
      throw new OrcaCommandFailedError(
        `Command "${command} ${args.join(" ")}" exited with status ${String(status)}`,
        {
          command,
          args: [...args],
          cwd,
          stdout,
          stderr,
          output: truncateCommandOutput([stderr, stdout].filter(Boolean).join("\n").trim()),
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

export function npmPackageNameErrors(name: string): string[] {
  // This local preflight catches common package-name failures before the
  // scaffolder mutates disk; framework generators still own stricter checks.
  const errors: string[] = [];
  if (name.length === 0) {
    errors.push("name is empty");
  }
  if (name.length > 214) {
    errors.push("name is longer than 214 characters");
  }
  if (name !== name.trim()) {
    errors.push("name contains leading or trailing whitespace");
  }
  if (/[A-Z]/.test(name)) {
    errors.push("name can no longer contain capital letters");
  }
  if (name.startsWith(".") || name.startsWith("_")) {
    errors.push("name cannot start with a period or underscore");
  }
  if (!/^[a-z0-9][a-z0-9._~-]*$/.test(name)) {
    errors.push(
      "name may only contain lowercase letters, numbers, dots, underscores, tildes, and hyphens",
    );
  }
  if (name === "node_modules" || name === "favicon.ico") {
    errors.push(`name "${name}" is reserved`);
  }
  return [...new Set(errors)];
}
