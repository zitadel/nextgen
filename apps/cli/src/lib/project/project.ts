import { EnvFile } from "./env-file";
import { Gitignore, type GitignoreRule } from "./gitignore";
import { ProjectConfig } from "./project-config";
import { ProjectSecret } from "./project-secret";
import { SecretFile } from "./secret-file";
import { SecretPath } from "./secret-path";

/**
 * A project on disk, and the one way into everything the CLI keeps in it: the
 * committed `zitadel.json`, the local `.zitadel/secret`, the managed `.env`
 * files and the root `.gitignore` rules that keep them out of version control.
 *
 * What is known without a directory (whether a path is secret, what an
 * environment's file is called) is on the class itself; what is read from one
 * is on an instance, made with {@link Project.at}.
 */
export class Project {
  /** The project's directory. */
  readonly cwd: string;

  /**
   * @param cwd - The project's directory.
   */
  private constructor(cwd: string) {
    this.cwd = cwd;
  }

  /**
   * The project in a directory.
   *
   * @param cwd - The project's directory.
   * @returns The project.
   */
  static at(cwd: string): Project {
    return new Project(cwd);
  }

  /**
   * Whether a path must never be committed: a `.zitadel/secret`, anything
   * under `.zitadel/local/`, or an `.env*` file other than `.env.example`.
   * Matched without regard to case, since `.ENV` is the same file as `.env` on
   * macOS and Windows.
   *
   * @param path - A path from the project's root, with `/` as the separator.
   * @returns `true` when it must stay out of version control.
   */
  static isSecret(path: string): boolean {
    return new SecretPath(path).isSecret();
  }

  /**
   * Whether a path is under `.zitadel/local/`, at any depth, where the local
   * server keeps its admin credential and data.
   *
   * @param path - A path from the project's root, with `/` as the separator.
   * @returns `true` when it is part of the local runtime.
   */
  static isLocalRuntime(path: string): boolean {
    return new SecretPath(path).isLocalRuntime();
  }

  /**
   * The file an environment's project id and secrets live in:
   * `.env.<name>.local`, which `env add` writes and a prompt's answer is saved
   * to.
   *
   * @param name - The environment.
   * @returns The file's name, in the project's root.
   */
  static envFileName(name: string): string {
    return EnvFile.nameFor(name);
  }

  /**
   * What `eject` renames an env file to, keeping the secrets it holds beside
   * the app rather than deleting them.
   *
   * @param path - The env file.
   * @param stamp - When it was ejected, as a name can hold it.
   * @returns The backup's path.
   */
  static ejectedBackup(path: string, stamp: string): string {
    return EnvFile.backupOf(path, stamp);
  }

  /**
   * One `key=value` line of an env file, quoted as much as it needs to read
   * back exactly.
   *
   * @param key - The variable.
   * @param value - Its value.
   * @returns The line, without its line break.
   * @throws {@link ZitadelError} When the value has a line break, or no
   *   quoting reads it back unchanged.
   */
  static envLine(key: string, value: string): string {
    return EnvFile.line(key, value);
  }

  /**
   * A managed env file, written at `0600` through the one writer.
   *
   * @param path - The file's path.
   * @returns The file.
   */
  static envFile(path: string): EnvFile {
    return new EnvFile(path);
  }

  /**
   * What the root `.gitignore` must hold, so the files the CLI writes stay out
   * of version control.
   *
   * @param rules - The rules to hold it to; those of the files the CLI writes
   *   when left out.
   * @returns The rules, and what it takes to meet them.
   */
  static gitignore(rules?: ReadonlyArray<GitignoreRule>): Gitignore {
    return new Gitignore(rules);
  }

  /**
   * Re-asserts a file's mode after a write, warning instead of failing when the
   * filesystem cannot apply it. The only place the CLI calls `chmod` after a
   * write.
   *
   * @param path - The file.
   * @param mode - The mode it must have.
   */
  static lockDown(path: string, mode: number): Promise<void> {
    return SecretFile.enforceMode(path, mode);
  }

  /**
   * Whether the project has been initialized, that is, a committed
   * `zitadel.json` exists. Decides whether setup should run or skip.
   *
   * @returns `true` when the file exists.
   */
  hasConfig(): Promise<boolean> {
    return ProjectConfig.exists(this.cwd);
  }

  /**
   * Reads `zitadel.json`.
   *
   * @returns The project's configuration.
   * @throws {@link ZitadelError} When there is no `zitadel.json`.
   */
  config(): Promise<ProjectConfig> {
    return ProjectConfig.read(this.cwd);
  }

  /**
   * Reads `zitadel.json`, or answers as an empty one when it cannot be read,
   * for a caller that has a fallback of its own.
   *
   * @returns The project's configuration, empty when it cannot be read.
   */
  async configOrEmpty(): Promise<ProjectConfig> {
    return this.config().catch(() => {
      return new ProjectConfig();
    });
  }

  /**
   * Whether local secret material is present. Gates commands that need
   * credentials, and signals that secrets were already pulled.
   *
   * @returns `true` when `.zitadel/secret` exists.
   */
  hasSecret(): Promise<boolean> {
    return ProjectSecret.exists(this.cwd);
  }

  /**
   * Reads and validates `.zitadel/secret`.
   *
   * @returns The secret.
   * @throws {@link ZitadelError} When there is none.
   * @throws {Error} When it lacks a required field.
   */
  secret(): Promise<ProjectSecret> {
    return ProjectSecret.read(this.cwd);
  }
}
