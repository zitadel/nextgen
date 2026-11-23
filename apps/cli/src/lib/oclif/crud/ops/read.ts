import { chosenColumns } from "@/lib/oclif/columns";
import { fieldPaths } from "@/lib/oclif/crud/paths";
import { idArg, idName, idValue } from "@/lib/oclif/crud/shared";
import type { GetSpec } from "@/lib/oclif/crud/types";
import { painted } from "@/lib/oclif/rendering";
import { fieldsFlag } from "@/lib/oclif/tabulatable";
import type { CommandResult } from "@/lib/oclif/types";
import { escapeControlCharacters } from "@/lib/terminal-text";

import {
  type OperationDefinition,
  type OperationInput,
  type OperationStatics,
  ResourceCommand,
} from "./command";

type ReadInput = OperationInput<
  Readonly<{
    fields?: readonly string[];
  }>,
  Record<string, string>
>;

/**
 * `<topic> get <id>`. A terminal gets the record laid out field by field,
 * headed by whatever identifies it; a pipe (and `--json`) gets the object
 * itself, because a script wants the record rather than a view of it.
 */
export abstract class GetOperation<Ctx> extends ResourceCommand<Ctx, GetSpec<Ctx>, ReadInput> {
  static describe<Ctx>({
    topic,
    resource,
    spec,
    options,
  }: OperationDefinition<Ctx, GetSpec<Ctx>>): OperationStatics {
    return {
      // A resource addressed by more than an id says so, as its argument does.
      description: `Get one ${resource.singular} by ${resource.idDescription ?? "id"}.`,
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

  protected override async operate({ flags, args }: ReadInput): Promise<CommandResult> {
    const { resource, spec } = this.definition;
    const shape = fieldPaths(spec.response);
    const item = await spec.call(await this.context(), idValue(resource, args));
    const fields = chosenColumns(flags.fields, resource.detail ?? resource.columns, [item], shape);
    const heading = headingOf(resource.heading ?? resource.idField, item);
    const title = `Read ${escapeControlCharacters(heading ?? resource.singular, { keepLayout: false })}`;

    const record = flags.fields === undefined ? item : this.pickFields(item, flags.fields);
    const sections =
      flags.fields === undefined
        ? ((await spec.sections?.(item, (columns, rows) => {
            return this.tabulate(columns, rows);
          })) ?? [])
        : [];
    const rendered = [this.tabulateDetail(undefined, fields, item), ...sections].join("\n\n");

    return {
      status: "ok",
      data: record,
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
