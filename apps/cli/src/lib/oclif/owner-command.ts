import { Flags } from "@oclif/core";
import { consola } from "consola";

import { createZitadelClient, type ZitadelClient } from "../api-client";
import { ZitadelError } from "../errors";
import { readZitadelSecret } from "../project";
import { BaseCommand } from "./base";
import type { GlobalOptions } from "./types";

/**
 * A command that addresses a project's variables. The project is the only
 * owner, and it is named rather than assumed — `--project-level` is required —
 * so that if variables gain another owner, every command already written keeps
 * meaning exactly what it means now.
 */
export abstract class OwnerCommand extends BaseCommand {
  static override baseFlags = {
    ...BaseCommand.baseFlags,
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
        hint: "The project level is the only owner the CLI can address.",
      });
    }
    return super.toMeta(flags, options);
  }

  /**
   * Open the platform connection, the counterpart of the resource commands'
   * `connect`.
   *
   * Which project and server the command is about is worth stating to a person,
   * but those lines share stdout with the result, so they are printed only on a
   * terminal: on a pipe the result travels alone, and `--json` silences them
   * either way.
   */
  protected async connect(): Promise<
    Readonly<{
      client: ZitadelClient;
      /** The query parameters every variables endpoint takes for this owner. */
      scope: Readonly<{ project_id: string }>;
    }>
  > {
    const { cwd, source } = this.meta;
    const secret = await readZitadelSecret(cwd);
    if (process.stdout.isTTY) {
      consola.info(`Project   ${secret.project_id}`);
      consola.info(`Server    ${source}`);
    }
    return {
      client: createZitadelClient({ baseUrl: source, token: secret.project_secret }),
      scope: { project_id: secret.project_id },
    };
  }
}
