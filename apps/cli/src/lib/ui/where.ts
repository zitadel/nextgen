import pc from "picocolors";

/**
 * Where a command ran, as the sentence every command's summary opens with, so
 * that "which project, on which server" is answered the same way everywhere
 * instead of as two `ℹ` lines before the first question.
 */
export class Where {
  private readonly project: string | undefined;
  private readonly server: string | undefined;

  constructor(project?: string, server?: string) {
    this.project = project;
    this.server = server;
  }

  /** Whether anything is known about where this ran. */
  get known(): boolean {
    return this.project !== undefined || this.server !== undefined;
  }

  /** Just the place, for a footer that already has its own wording. */
  get plain(): string {
    const target = this.project === undefined ? "" : `project ${this.project}`;
    if (this.server === undefined) {
      // Nothing to name but the project, and "on your Zitadel project" reads
      // as a second, different place.
      return target;
    }
    // A command that resolves no project — `stop`, `doctor`, `setup` — still
    // says where it ran as a phrase rather than a bare host, so the footer
    // reads the same either way: `… · on localhost:8080`.
    return `${target === "" ? "on " : `${target} on `}${this.server}`;
  }

  /** The same sentence every time, as the last line of the summary. */
  render(): string {
    const target = this.project === undefined ? "" : ` project ${this.project} on`;
    return pc.dim(`Using${target} ${this.describeServer()}.`);
  }

  /**
   * A server the person runs themselves is named as theirs: on a local run the
   * host is an address on this machine and says nothing by itself.
   */
  private describeServer(): string {
    if (this.server === undefined) {
      return "your Zitadel project";
    }
    const local = /^(localhost|127\.0\.0\.1|\[::1])(:\d+)?$/.test(this.server);
    return `your ${local ? "local " : ""}Zitadel server at ${this.server}`;
  }
}
