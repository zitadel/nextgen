import { Flags } from "@oclif/core";

import { chosenColumns } from "../columns";
import { fieldPaths } from "../paths";
import { idArg } from "../shared";
import { renderDetail } from "../table";
import type { GetSpec } from "../types";
import type { CommandResult, GlobalOptions } from "../../types";
import {
  type OperationDefinition,
  type OperationInput,
  type OperationStatics,
  ResourceCommand,
} from "./command";

/**
 * `<topic> get <id>`. A terminal gets the record laid out field by field,
 * headed by whatever identifies it; a pipe (and `--json`) gets the object
 * itself, because a script wants the record rather than a view of it.
 */
export class GetOperation<Ctx> extends ResourceCommand<Ctx, GetSpec<Ctx>> {
  static describe<Ctx>({
    topic,
    resource,
    options,
  }: OperationDefinition<Ctx, GetSpec<Ctx>>): OperationStatics {
    return {
      description: `Get one ${resource.singular} by id.`,
      examples: [
        `<%= config.bin %> ${topic} get <id>`,
        `<%= config.bin %> ${topic} get <id> --json`,
      ],
      flags: {
        fields: Flags.string({
          description:
            "Fields to show, comma-separated dot-paths. Defaults to the resource's own; `--json` is unaffected.",
        }),
        ...options.flags,
      },
      args: idArg(resource),
    };
  }

  protected override async execute(
    { flags, args }: OperationInput,
    meta: GlobalOptions,
  ): Promise<CommandResult> {
    const { resource, spec } = this.definition;
    // Same as `list`: a schema decides `--fields` before the request is made.
    const shape = fieldPaths(spec.response);
    const early = shape
      ? chosenColumns(flags.fields, resource.detail ?? resource.columns, [], shape)
      : undefined;
    const item = await spec.call(await this.connect(meta), String(args.id));
    // Validated before the output branch, so the same arguments are valid (or
    // not) whether the result goes to a terminal or a pipe.
    const fields = early ?? chosenColumns(flags.fields, resource.detail ?? resource.columns, [item]);
    if (!process.stdout.isTTY) {
      return { status: "ok", data: item, pretty: JSON.stringify(item, null, 2) };
    }
    return {
      status: "ok",
      data: item,
      pretty: renderDetail(headingOf(resource.heading ?? resource.idField, item), fields, item),
    };
  }
}

/** The value that heads the rendering, when the record carries one. */
const headingOf = (path: string, item: unknown): string | undefined => {
  const value = path
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        typeof current === "object" && current !== null
          ? (current as Record<string, unknown>)[key]
          : undefined,
      item,
    );
  return typeof value === "string" ? value : undefined;
};
