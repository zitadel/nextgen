/** Options passed to a scaffolder when creating a new project. */
export type ScaffoldOptions = {
  readonly projectName?: string;
  readonly packageManager?: string;
};

/** Returned by a scaffolder after the project has been created. */
export type ScaffolderResult = {
  readonly ok: true;
};

/** A scaffolder creates a new project from scratch in the given directory. */
export interface Scaffolder {
  /** Machine identifier for this scaffolder type (e.g. "cli", "llm"). */
  readonly kind: string;
  /** Human-readable label shown in the framework picker. */
  readonly displayName: string;
  /** List of framework identifiers this scaffolder can produce. */
  readonly supportedFrameworks: readonly string[];

  /**
   * Returns true if this scaffolder can produce the requested framework.
   * Used by the Orca orchestrator to select the right scaffolder.
   */
  canScaffold(framework: string): boolean;

  /**
   * Creates a new project in `cwd` for the given framework.
   * The directory may be empty but must already exist.
   */
  scaffold(cwd: string, framework: string, opts: ScaffoldOptions): Promise<ScaffolderResult>;
}

/** Base class for scaffolders that delegate to a CLI tool (e.g. create-next-app). */
export abstract class AbstractCLIScaffolder implements Scaffolder {
  readonly kind = "cli" as const;
  abstract readonly displayName: string;
  abstract readonly supportedFrameworks: readonly string[];

  /** Returns true when the requested framework is in this scaffolder's supported list. */
  canScaffold(framework: string): boolean {
    return this.supportedFrameworks.includes(framework);
  }

  /** Creates the project by invoking the underlying CLI tool synchronously. */
  abstract scaffold(cwd: string, framework: string, opts: ScaffoldOptions): Promise<ScaffolderResult>;

  /**
   * Runs a command synchronously with inherited stdio so the user sees the
   * scaffolder's output in real time. Throws if the command exits non-zero.
   */
  protected runCommand(cmd: string, args: readonly string[], cwd: string): void {
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const result = spawnSync(cmd, [...args], { cwd, stdio: "inherit" });
    if (result.status !== 0) {
      throw new Error(`Command "${cmd} ${args.join(" ")}" exited with status ${String(result.status)}`);
    }
  }
}

/** Base class for AI-driven scaffolders that generate the project via an LLM. */
export abstract class AbstractLLMScaffolder implements Scaffolder {
  readonly kind = "llm" as const;
  abstract readonly displayName: string;
  abstract readonly supportedFrameworks: readonly string[];

  /** Returns true when the framework is "*" (universal) or explicitly listed. */
  canScaffold(framework: string): boolean {
    return (
      this.supportedFrameworks.includes("*") || this.supportedFrameworks.includes(framework)
    );
  }

  /** Creates the project using an AI agent. */
  abstract scaffold(cwd: string, framework: string, opts: ScaffoldOptions): Promise<ScaffolderResult>;
}

/** Base class for scaffolders that clone a git template repository. */
export abstract class AbstractGitCloneScaffolder implements Scaffolder {
  readonly kind = "git-clone" as const;
  abstract readonly displayName: string;
  abstract readonly supportedFrameworks: readonly string[];
  abstract readonly templateUrl: string;

  /** Returns true when the requested framework is in this scaffolder's supported list. */
  canScaffold(framework: string): boolean {
    return this.supportedFrameworks.includes(framework);
  }

  /**
   * Clones the template repository into `cwd` and removes the `.git` directory
   * so the user starts with a clean working tree.
   */
  async scaffold(cwd: string, _framework: string, _opts: ScaffoldOptions): Promise<ScaffolderResult> {
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const clone = spawnSync("git", ["clone", "--depth=1", this.templateUrl, "."], {
      cwd,
      stdio: "inherit",
    });
    if (clone.status !== 0) {
      throw new Error(`git clone failed with status ${String(clone.status)}`);
    }
    const rmGit = spawnSync("rm", ["-rf", ".git"], { cwd, stdio: "inherit" });
    if (rmGit.status !== 0) {
      throw new Error(`Could not remove .git directory`);
    }
    return { ok: true };
  }
}
