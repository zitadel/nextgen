/**
 * A path in a project, and what the CLI must know of it before it reaches
 * version control.
 */
export class SecretPath {
  /** The path, from the project's root, with `/` as the separator. */
  readonly path: string;

  /**
   * @param path - The path, from the project's root.
   */
  constructor(path: string) {
    this.path = path;
  }

  /**
   * Whether it must never be committed: a `.zitadel/secret`, anything under
   * `.zitadel/local/`, or an `.env*` file other than `.env.example`.
   *
   * Matched without regard to case, since `.ENV` is the same file as `.env` on
   * macOS and Windows.
   *
   * @returns `true` when it must stay out of version control.
   */
  isSecret(): boolean {
    const lower = this.path.toLowerCase();
    const name = lower.split("/").pop() ?? lower;
    if (lower === ".zitadel/secret" || lower.endsWith("/.zitadel/secret")) {
      return true;
    }
    if (new SecretPath(lower).isLocalRuntime()) {
      return true;
    }
    return name.startsWith(".env") && name !== ".env.example";
  }

  /**
   * Whether it is under `.zitadel/local/`, at any depth, where the local server
   * keeps its admin credential and data.
   *
   * Matched with its case, since it names the directory `start` writes; on a
   * case-sensitive filesystem `.Zitadel/Local/` is someone else's.
   *
   * @returns `true` when it is part of the local runtime.
   */
  isLocalRuntime(): boolean {
    return /(^|\/)\.zitadel\/local(\/|$)/.test(this.path);
  }
}
