import { Flags } from "@oclif/core";

import { chosenColumns, readColumns } from "@/lib/oclif/crud/columns";
import { type FieldPaths, fieldPaths } from "@/lib/oclif/crud/paths";
import { article, idArg, idName, idValue } from "@/lib/oclif/crud/shared";
import type { GetSpec } from "@/lib/oclif/crud/types";
import type { CommandResult } from "@/lib/oclif/types";
import { json, painted } from "@/lib/oclif/rendering";
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
export class GetOperation<Ctx> extends ResourceCommand<Ctx, GetSpec<Ctx>, ReadInput> {
  static describe<Ctx>({
    topic,
    resource,
    spec,
    options,
  }: OperationDefinition<Ctx, GetSpec<Ctx>>): OperationStatics {
    return {
      // A resource addressed by more than an id says so, as its argument does.
      heading: `Reading ${article(resource.singular)} ${resource.singular}`,
      description: `Get one ${resource.singular} by ${resource.idDescription ?? "id"}.`,
      examples: [
        `<%= config.bin %> ${topic} get <${idName(resource)}>`,
        `<%= config.bin %> ${topic} get <${idName(resource)}> --json`,
      ],
      flags: {
        fields: Flags.custom<
          readonly string[],
          Readonly<{ fallback: readonly string[]; shape?: FieldPaths }>
        >({
          parse: async (input, _command, flag) => {
            return readColumns(input, flag.fallback, flag.shape);
          },
        })({
          description:
            "Fields to show, comma-separated dot-paths. Defaults to the resource's own; `--json` is unaffected.",
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
    // Read, said of what was read: the identifier heads the record, and the
    // record is spelled out where it is read, so only the words here are ours.
    const title = `Read ${escapeControlCharacters(heading ?? resource.singular)}`;
    if (!this.isOnScreen) {
      return { status: "ok", data: item, pretty: json(item), summary: { title, sections: [] } };
    }
    const sections =
      flags.fields === undefined && !this.isJson
        ? ((await spec.sections?.(item, (columns, rows) => this.tabulate(columns, rows))) ?? [])
        : [];
    const record = [this.tabulateDetail(undefined, fields, item), ...sections].join("\n\n");
    return {
      status: "ok",
      data: item,
      pretty: painted(
        [...(heading === undefined ? [] : [escapeControlCharacters(heading), ""]), record].join(
          "\n",
        ),
      ),
      summary: { title, sections: [], lines: record.split("\n") },
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
