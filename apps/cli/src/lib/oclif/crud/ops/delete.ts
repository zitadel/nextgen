import { cancel, confirm, isCancel } from "@clack/prompts";
import { Flags } from "@oclif/core";

import { ZitadelError } from "../../../errors";
import { publicCliCommand } from "../../../public-cli";
import type { CommandResult, GlobalOptions } from "../../types";
import { capitalize, dryRunResult, idArg, idValue } from "../shared";
import type { DeleteSpec } from "../types";
import {
  type OperationDefinition,
  type OperationInput,
  type OperationStatics,
  ResourceCommand,
} from "./command";

/**
 * `<topic> delete <id>`: guarded like `reset` — `--force` in non-interactive
 * mode, a confirm prompt otherwise — and honours `--dry-run`. What the server
 * actually did (`deleted`, `revoked`, `deactivated`) is reported in the
 * result rather than changing the verb.
 */
export class DeleteOperation<Ctx> extends ResourceCommand<Ctx, DeleteSpec<Ctx>> {
  static describe<Ctx>({
    topic,
    resource,
    spec,
    options,
  }: OperationDefinition<Ctx, DeleteSpec<Ctx>>): OperationStatics {
    return {
      description: `Delete a ${resource.singular} by id.`,
      examples: [`<%= config.bin %> ${topic} delete <id> --force --json`],
      // `--force` is per command, not global: here it permits a deletion,
      // where on `setup` the same name permits overwriting a file.
      flags: {
        force: Flags.boolean({
          char: "f",
          description: `Delete the ${resource.singular} without the confirmation prompt. Required when non-interactive.`,
        }),
        ...options.flags,
      },
      args: idArg(resource),
    };
  }

  protected override async execute(
    { args }: OperationInput,
    meta: GlobalOptions,
  ): Promise<CommandResult> {
    const { topic, resource, spec } = this.definition;
    const past = spec.outcome ?? "deleted";
    const id = idValue(resource, args);

    // A dry run makes no request, so it answers before the guard — the order
    // `reset` uses, and it keeps `--dry-run --non-interactive` usable.
    if (meta.dryRun) {
      return dryRunResult("delete", topic, id);
    }

    if (!meta.force) {
      if (meta.nonInteractive) {
        throw new ZitadelError(
          "E_VALIDATION",
          "Delete requires --force in non-interactive mode",
          {
            hint: `Pass --force to delete ${resource.singular} ${id}.`,
            nextCommands: [publicCliCommand(`${topic} delete ${id} --force`, meta.cliVersion)],
          },
        );
      }
      const answer = await confirm({
        message: `Delete ${resource.singular} ${id}?`,
        initialValue: false,
      });
      if (isCancel(answer) || !answer) {
        cancel("Delete cancelled.");
        return { status: "skipped", reason: "delete-cancelled" };
      }
    }
    await spec.call(await this.connect(meta), id);
    return {
      status: "ok",
      data: { id, [past]: true },
      pretty: `${capitalize(past)} ${resource.singular} ${id}`,
    };
  }
}
