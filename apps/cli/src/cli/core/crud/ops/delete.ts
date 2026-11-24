import type { Admitted, BaseCommand } from "@/cli/core/base";
import { Destructive } from "@/cli/core/destructive";
import { Previewable } from "@/cli/core/previewable";
import { article, capitalize, dryRunResult, idArg, idValue } from "@/cli/core/crud/shared";
import type { DeleteSpec, Json } from "@/cli/core/crud/types";
import { deletedData, mutatedData } from "@/cli/core/envelope";
import { prose } from "@/lib/oclif/rendering";
import type { CommandResult } from "@/cli/core/types";
import { escapeControlCharacters } from "@/lib/terminal-text";

import {
  type OperationDefinition,
  type OperationInput,
  type OperationStatics,
  ResourceCommand,
} from "./command";

/** Past tense reported beside the id, per verb. */
const PAST: Readonly<Record<string, string>> = {
  delete: "deleted",
  revoke: "revoked",
  deactivate: "deactivated",
};

type DeleteInput = OperationInput<Json, Record<string, string>>;

/**
 * `<topic> delete <id>`, or the lifecycle verb the resource declares
 * (`revoke`, `deactivate`): guarded like `reset` — `--force` in
 * non-interactive mode, a confirm prompt otherwise — and honours `--dry-run`.
 */
export abstract class DeleteOperation<Ctx> extends Destructive(Previewable(ResourceCommand)) {
  static describe<Ctx>({
    topic,
    resource,
    spec,
    options,
  }: OperationDefinition<Ctx, DeleteSpec<Ctx>>): OperationStatics {
    const verb = spec.verb ?? "delete";

    return {
      description: `${capitalize(verb)} ${article(resource.singular)} ${resource.singular} by id.`,
      examples: [`<%= config.bin %> ${topic} ${verb} <id> --force --json`],
      force: `${capitalize(verb)} the ${resource.singular} without the confirmation prompt. Required when non-interactive.`,
      flags: {
        ...options.flags,
      },
      args: idArg(resource, topic),
    };
  }

  /**
   * What the deletion would do, said without reading, asking or acting.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The envelope of the dry run.
   */
  protected override async preview(input: Admitted<typeof BaseCommand>): Promise<CommandResult> {
    const { args } = input as DeleteInput;
    const { topic, resource, spec } = this.defined<Ctx, DeleteSpec<Ctx>>();

    return dryRunResult({
      verb: spec.verb ?? "delete",
      topic,
      noun: resource.singular,
      id: idValue(resource, args),
      next: await this.realRun(),
    });
  }

  /**
   * Asks for consent, then does the deletion.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The envelope of the run.
   */
  protected override async apply(input: Admitted<typeof BaseCommand>): Promise<CommandResult> {
    const { args } = input as DeleteInput;
    const { resource, spec } = this.defined<Ctx, DeleteSpec<Ctx>>();
    const verb = spec.verb ?? "delete";
    const past = spec.outcome ?? PAST[verb] ?? "deleted";
    const id = idValue(resource, args);

    return await this.confirmed({
      verb,
      name: `${verb} ${resource.singular} ${id}`,
      message: async () => {
        const { projectId, server } = await this.connect();

        return `${capitalize(verb)} ${resource.singular} ${id} in project ${projectId} on ${server.replace(/^https?:\/\//, "")}?`;
      },
      prepare: () => {
        return this.context<Ctx>();
      },
      apply: async (consent, context) => {
        await spec.call(context, id, consent);

        return {
          status: "ok",
          data: past === "deleted" ? deletedData({ id }) : mutatedData({ id }, past),
          pretty: prose(`${capitalize(past)} ${resource.singular} ${id}`),
          summary: {
            title: `${capitalize(past)} ${resource.singular} ${escapeControlCharacters(id, { keepLayout: false })}`,
            sections: [],
          },
        };
      },
    });
  }
}
