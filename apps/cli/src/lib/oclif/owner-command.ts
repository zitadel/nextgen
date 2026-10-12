import { Flags } from "@oclif/core";

import { ZitadelError } from "../errors";
import { type Connection, EnvironmentCommand } from "./environment-command";
import type { GlobalOptions } from "./types";

/**
 * A command that addresses one owner of a project's variables. The platform has
 * two kinds — an environment, or the project level — and they are separate
 * rather than a ladder: nothing one holds reaches the other (ADR 062 §4).
 *
 * Only the project level can be addressed from the CLI today. The platform's
 * environments are still unsettled (#1258 may rename or drop them), and a
 * half-meant owner flag is worse than none: a value written on a name the
 * platform later spells differently is a value nothing will ever read. The
 * owner is therefore named rather than assumed — `--project-level` is required
 * — so that when another owner returns, every command already written keeps
 * meaning exactly what it means now.
 */
export abstract class OwnerCommand extends EnvironmentCommand {
  static override baseFlags = {
    ...EnvironmentCommand.baseFlags,
    "project-level": Flags.boolean({
      description:
        "Address the project level. Required: it is the only owner the CLI can address today.",
    }),
  };

  /**
   * Refuse an invocation that names no owner, then build the invocation
   * context. The refusal is the same on a terminal and in a script: with one
   * owner available there is nothing to ask about, and a prompt offering a
   * single answer is a keystroke, not a choice.
   *
   * It comes before `super.toMeta`, which resolves the server — a run that
   * named no owner is refused whatever `--server` says, rather than answering
   * `E_LOCAL_SERVER_NOT_RUNNING` for a `--server local` with nothing running.
   */
  protected override async toMeta(
    flags: Record<string, unknown>,
    options: { resolveServer?: boolean; source?: string } = {},
  ): Promise<GlobalOptions> {
    if (flags["project-level"] !== true) {
      throw new ZitadelError("E_VALIDATION", "Name the owner: --project-level", {
        hint: "The project level is the only owner the CLI can address today.",
      });
    }
    return super.toMeta(flags, options);
  }

  /**
   * Open the platform connection, with the query parameters every variables
   * endpoint takes for this owner.
   */
  protected override async connect(): Promise<
    Connection & {
      scope: Readonly<{ project_id: string }>;
    }
  > {
    const connection = await super.connect();
    return { ...connection, scope: { project_id: connection.projectId } };
  }
}
