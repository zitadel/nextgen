import { Flags } from "@oclif/core";

import { deletedData, mutatedData } from "@/lib/oclif/envelope";
import type { CommandResult } from "@/lib/oclif/types";
import { article, capitalize, dryRunResult, idArg, idValue } from "@/lib/oclif/crud/shared";
import type { DeleteSpec, Json } from "@/lib/oclif/crud/types";
import { prose } from "@/lib/oclif/rendering";
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
export class DeleteOperation<Ctx> extends ResourceCommand<Ctx, DeleteSpec<Ctx>, DeleteInput> {
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
      // `--force` is per command, not global: here it permits a deletion,
      // where on `setup` the same name permits overwriting a file.
      flags: {
        force: Flags.boolean({
          char: "f",
          description: `${capitalize(verb)} the ${resource.singular} without the confirmation prompt. Required when non-interactive.`,
        }),
        ...options.flags,
      },
      args: idArg(resource, topic),
    };
  }

  protected override async operate({ args }: DeleteInput): Promise<CommandResult> {
    const { topic, resource, spec } = this.definition;
    const verb = spec.verb ?? "delete";
    const past = spec.outcome ?? PAST[verb] ?? "deleted";
    const id = idValue(resource, args);

    return this.confirmed({
      verb,
      name: `${verb} ${resource.singular} ${id}`,
      message: () => {
        const { values } = this.environment;
        const project = values.ZITADEL_PROJECT_ID?.value;
        const server = values.ZITADEL_URL?.value;
        const place = [
          project === undefined ? "" : ` in project ${escapeControlCharacters(project)}`,
          server === undefined
            ? ""
            : ` on ${escapeControlCharacters(server.replace(/^https?:\/\//, ""))}`,
        ].join("");
        return `${capitalize(verb)} ${resource.singular} ${id}${place}?`;
      },
      preview: () => dryRunResult({ verb, topic, id }),
      prepare: () => this.context(),
      apply: async (consent, context) => {
        await spec.call(context, id, consent);
        return {
          status: "ok",
          data: past === "deleted" ? deletedData({ id }) : mutatedData({ id }, past),
          pretty: prose(`${capitalize(past)} ${resource.singular} ${id}`),
          summary: {
            title: `${capitalize(past)} ${resource.singular} ${escapeControlCharacters(id)}`,
            sections: [],
          },
        };
      },
    });
  }
}
