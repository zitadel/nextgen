import { cancel, confirm, isCancel } from "@clack/prompts";
import { Flags } from "@oclif/core";

import { ZitadelError } from "../../../errors";
import { publicCliCommand } from "../../../public-cli";
import type { CommandResult, GlobalOptions } from "../../types";
import { capitalize, dryRunResult, idArg } from "../shared";
import type { DeleteSpec } from "../types";
import {
  type OperationDefinition,
  type OperationInput,
  type OperationStatics,
  ResourceCommand,
} from "./command";

/**
 * `<topic> delete <id>` (or `revoke`): guarded like `reset` — `--force` in
 * non-interactive mode, a confirm prompt otherwise — and honours `--dry-run`.
 */
export class DeleteOperation<Ctx> extends ResourceCommand<Ctx, DeleteSpec<Ctx>> {
  static describe<Ctx>({
    topic,
    resource,
    spec,
    options,
  }: OperationDefinition<Ctx, DeleteSpec<Ctx>>): OperationStatics {
    const verb = spec.verb ?? "delete";
    return {
      description: `${capitalize(verb)} a ${resource.singular} by id.`,
      examples: [`<%= config.bin %> ${topic} ${verb} <id> --force --json`],
      // `--force` is per command, not global: here it permits a deletion,
      // where on `setup` the same name permits overwriting a file.
      flags: {
        force: Flags.boolean({
          char: "f",
          description: `${capitalize(verb)} the ${resource.singular} without the confirmation prompt. Required when non-interactive.`,
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
    const verb = spec.verb ?? "delete";
    const past = spec.outcome ?? (verb === "revoke" ? "revoked" : "deleted");
    const id = String(args.id);

    // A dry run makes no request, so it answers before the guard — the order
    // `reset` uses, and it keeps `--dry-run --non-interactive` usable.
    if (meta.dryRun) {
      return dryRunResult(verb, topic, id);
    }

    if (!meta.force) {
      if (meta.nonInteractive) {
        throw new ZitadelError(
          "E_VALIDATION",
          `${capitalize(verb)} requires --force in non-interactive mode`,
          {
            hint: `Pass --force to ${verb} ${resource.singular} ${id}.`,
            nextCommands: [publicCliCommand(`${topic} ${verb} ${id} --force`, meta.cliVersion)],
          },
        );
      }
      const answer = await confirm({
        message: `${capitalize(verb)} ${resource.singular} ${id}?`,
        initialValue: false,
      });
      if (isCancel(answer) || !answer) {
        cancel(`${capitalize(verb)} cancelled.`);
        return { status: "skipped", reason: `${verb}-cancelled` };
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
