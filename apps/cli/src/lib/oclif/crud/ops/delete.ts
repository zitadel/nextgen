import { Flags } from "@oclif/core";

import { deletedData, mutatedData } from "../../envelope";
import type { CommandResult, GlobalOptions } from "../../types";
import { article, capitalize, dryRunResult, idArg, idValue } from "../shared";

/** The gerund each verb heads its output with. */
const GERUND: Readonly<Record<string, string>> = {
  delete: "deleting",
  revoke: "revoking",
  deactivate: "deactivating",
};

/** Past tense reported beside the id, per verb. */
const PAST: Readonly<Record<string, string>> = {
  delete: "deleted",
  revoke: "revoked",
  deactivate: "deactivated",
};
import type { DeleteSpec } from "../types";
import {
  type OperationDefinition,
  type OperationInput,
  type OperationStatics,
  ResourceCommand,
} from "./command";

/**
 * `<topic> delete <id>`, or the lifecycle verb the resource declares
 * (`revoke`, `deactivate`): guarded like `reset` — `--force` in
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
      heading: `${capitalize(GERUND[verb] ?? `${verb}ing`)} ${article(resource.singular)} ${resource.singular}`,
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
      args: idArg(resource),
    };
  }

  protected override async execute(
    { args }: OperationInput,
    meta: GlobalOptions,
  ): Promise<CommandResult> {
    const { topic, resource, spec } = this.definition;
    const verb = spec.verb ?? "delete";
    const past = spec.outcome ?? PAST[verb] ?? "deleted";
    const id = idValue(resource, args);

    // A dry run makes no request, so it answers before the guard — the order
    // `reset` uses, and it keeps `--dry-run --non-interactive` usable.
    if (meta.dryRun) {
      return dryRunResult(verb, topic, id);
    }

    const confirmed = await this.ask.confirm({
      name: `${verb} ${resource.singular} ${id}`,
      message: `${capitalize(verb)} ${resource.singular} ${id}?`,
      retry: this.suggest(`${topic} ${verb} ${id} --force`),
    });
    if (!confirmed) {
      return { status: "skipped", reason: `${verb}-cancelled` };
    }
    await spec.call(await this.context(), id);
    return {
      status: "ok",
      data: past === "deleted" ? deletedData({ id }) : mutatedData({ id }, past),
      pretty: `${capitalize(past)} ${resource.singular} ${id}`,
    };
  }
}
