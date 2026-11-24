import { fieldPaths } from "@/cli/core/crud/paths";
import { idArg, idName, idValue } from "@/cli/core/crud/shared";
import type { GetSpec } from "@/cli/core/crud/types";
import { painted } from "@/lib/oclif/rendering";
import { fieldsFlag } from "@/cli/core/tabulatable";
import type { Admitted, BaseCommand } from "@/cli/core/base";
import type { CommandResult } from "@/cli/core/types";
import { escapeControlCharacters } from "@/lib/terminal-text";

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
export abstract class GetOperation<Ctx> extends ResourceCommand {
  static describe<Ctx>({
    topic,
    resource,
    spec,
    options,
  }: OperationDefinition<Ctx, GetSpec<Ctx>>): OperationStatics {
    const addressedBy = resource.idDescription ?? "id";
    return {
      description: `Get one ${resource.singular} by ${addressedBy}.`,
      examples: [
        `<%= config.bin %> ${topic} get <${idName(resource)}>`,
        `<%= config.bin %> ${topic} get <${idName(resource)}> --json`,
      ],
      flags: {
        fields: fieldsFlag({
          fallback: resource.detail ?? resource.columns,
          shape: fieldPaths(spec.response),
        }),
        ...options.flags,
      },
      args: idArg(resource, topic),
    };
  }

  /**
   * Runs the operation and ends the run with its result. A read has no dry run
   * and no confirmation, so this is the whole of its lifecycle.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The envelope of the run.
   */
  protected override async execute(input: Admitted<typeof BaseCommand>): Promise<CommandResult> {
    const { flags, args } = input as OperationInput<
      Readonly<{
        fields?: readonly string[];
      }>,
      Record<string, string>
    >;
    const { resource, spec } = this.defined<Ctx, GetSpec<Ctx>>();
    const item = await spec.call(await this.context<Ctx>(), idValue(resource, args));
    const heading = headingOf(resource.heading ?? resource.idField, item);
    const title = `Read ${escapeControlCharacters(heading ?? resource.singular, { keepLayout: false })}`;

    const view = this.viewRecord(item, flags.fields, resource.detail ?? resource.columns);
    const sections =
      flags.fields === undefined
        ? ((await spec.sections?.(item, (columns, rows) => {
            return this.tabulate(columns, rows);
          })) ?? [])
        : [];
    const rendered = [this.tabulateDetail(undefined, view.columns, item), ...sections].join("\n\n");

    return {
      status: "ok",
      data: view.data,
      pretty: painted(
        [...(heading === undefined ? [] : [escapeControlCharacters(heading), ""]), rendered].join(
          "\n",
        ),
      ),
      summary: {
        title,
        sections: [],
        lines: rendered.split("\n"),
      },
    };
  }
}

/** The value that heads the rendering, when the record carries one. */
const headingOf = (path: string, item: unknown): string | undefined => {
  const value = path.split(".").reduce<unknown>((current, key) => {
    return typeof current === "object" && current !== null
      ? (current as Record<string, unknown>)[key]
      : undefined;
  }, item);

  return typeof value === "string" ? value : undefined;
};
