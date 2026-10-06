import { Flags } from "@oclif/core";
import { consola } from "consola";

import type { ZitadelClient } from "./api-client";
import { BaseCommand } from "./oclif/base";
import { connectTarget } from "./target";

/** Which value of a variable a `vars` command addresses. */
export type AppliesTo = "all" | "preview";

/**
 * A command on the project's variables. `--preview` addresses the override a
 * preview deploy prefers; without it, the value every deploy freezes.
 */
export abstract class VarsCommand extends BaseCommand {
  static override baseFlags = {
    ...BaseCommand.baseFlags,
    preview: Flags.boolean({
      description: "Address the value previews get instead of the one every deploy gets.",
    }),
  };

  protected appliesTo(flags: Record<string, unknown>): AppliesTo {
    return flags.preview === true ? "preview" : "all";
  }

  protected async connect(): Promise<
    Readonly<{ client: ZitadelClient; scope: Readonly<{ project_id: string }> }>
  > {
    const { cwd, env, serverFlag, envName, envFile } = this.meta;
    const { client, projectId, server } = await connectTarget({
      cwd,
      env,
      serverFlag,
      envName,
      envFile,
    });
    if (process.stdout.isTTY) {
      consola.info(`Project   ${projectId}`);
      consola.info(`Server    ${server}`);
    }
    return { client, scope: { project_id: projectId } };
  }
}
