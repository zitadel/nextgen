import { Flags } from "@oclif/core";

import { Cmd } from "@/lib/cmd";
import { type Assignment, readAssignment } from "@/lib/oclif/crud/assign";
import {
  type BodyField,
  bodyFieldFlags,
  describeBody,
  documentSchemaOf,
  fieldExample,
  flagsAloneMayBeIncomplete,
} from "@/lib/oclif/crud/fields";
import { resourceBody } from "@/lib/oclif/crud/resource-body";
import { article, dryRunResult, idArg, idName } from "@/lib/oclif/crud/shared";
import type {
  CreateSpec,
  Json,
  ResourceCommandOptions,
  ResourceDescriptor,
  UpdateSpec,
  WriteResult,
  WriteShape,
} from "@/lib/oclif/crud/types";
import type { ZodLike } from "@/lib/oclif/crud/zod";
import { nonBlankString } from "@/lib/oclif/flags";
import { named } from "@/lib/oclif/names";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { json } from "@/lib/oclif/rendering";
import type { CommandResult } from "@/lib/oclif/types";
import { escapeControlCharacters, escapeJsonControlCharacters } from "@/lib/terminal-text";
import type { Summary } from "@/lib/ui";

import {
  type OperationDefinition,
  type OperationInput,
  type OperationStatics,
  ResourceCommand,
} from "./command";

/**
 * `--data` / `--file`: the whole document at once, and `--set`: one field of
 * it by path. Together with the field flags they make the body in one order
 * (ADR 071 §1): the document, then the field flags, then each `--set`, every
 * one merged over the last.
 */
const rawBodyFlags = (document: ZodLike | undefined, fields: readonly BodyField[]) => {
  return {
    data: nonBlankString({
      description: "Whole body as a JSON object. Field flags and --set apply over it.",
      exclusive: ["file"],
      helpGroup: "RAW BODY",
    }),
    file: nonBlankString({
      description:
        "Read the body from a JSON file; `-` reads stdin. Field flags and --set apply over it.",
      exclusive: ["data"],
      helpGroup: "RAW BODY",
    }),
    set: Flags.custom<
      Assignment,
      Readonly<{ document: ZodLike | undefined; fields: readonly BodyField[] }>
    >({
      parse: async (input, _command, flag) => {
        return readAssignment(input, flag.document, flag.fields);
      },
    })({
      description:
        'Set one field by its dot path: path=value, or path:=json for JSON. Repeatable; applied after the field flags, in order. A key that contains a dot is set through its parent: --set \'parent:={"a.b":"x"}\'.',
      multiple: true,
      helpGroup: "RAW BODY",
      document,
      fields,
    }),
  };
};

/**
 * Each schema's fields, described once: the walk is the same every time it is
 * asked for. The description also depends on which part of the body is read
 * and which flag names are already taken, and two writes can share one body
 * schema while differing in either, so the answer is kept under both.
 */
const described = new WeakMap<object, Map<string, readonly BodyField[]>>();

/**
 * A write's fields, read the same way for its `--help` and for a run, and
 * described once per schema rather than on every invocation.
 */
const fieldsOf = <Ctx>(
  spec: WriteShape & { schema: CreateSpec<Ctx>["schema"] },
  options: ResourceCommandOptions<Ctx>,
): readonly BodyField[] => {
  const reserved = Object.keys(options.flags ?? {});
  const under = `${spec.root ?? ""}\u0000${reserved.join("\u0000")}`;
  const forSchema = described.get(spec.schema as object) ?? new Map();
  described.set(spec.schema as object, forSchema);

  const already = forSchema.get(under);
  if (already !== undefined) {
    return already;
  }

  const fields = describeBody(spec.schema, { root: spec.root, reserved });
  forSchema.set(under, fields);

  return fields;
};

/**
 * The `--file` example's file name, the singular as one shell word:
 * `./identity-provider-connection.json`, where the singular itself would be
 * split by a shell into three arguments.
 */
const exampleFile = (singular: string): string => {
  return `./${singular.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.json`;
};

/**
 * `<topic> create` and `<topic> update <id>` share everything but the id
 * argument. The body comes from a document (`--data` / `--file`), from one
 * flag per schema field, from `--set`, or from any mix of them. It is
 * validated against the request schema before the call, and the resource is
 * echoed back with a `next_commands` hint at the matching `get`.
 */
const describeWrite = <
  Ctx,
  Spec extends WriteShape & { readonly schema: CreateSpec<Ctx>["schema"] },
>(
  { topic, resource, spec }: OperationDefinition<Ctx, Spec>,
  options: ResourceCommandOptions<Ctx>,
  verb: "create" | "update",
): OperationStatics => {
  const fields = fieldsOf(spec, options);
  const document = documentSchemaOf(spec.schema, spec.root);
  const example =
    spec.example ?? (flagsAloneMayBeIncomplete(fields) ? undefined : fieldExample(fields));
  const command = `<%= config.bin %> ${topic} ${verb}${verb === "update" ? " <id>" : ""}`;

  return {
    description:
      verb === "create"
        ? `Create ${article(resource.singular)} ${resource.singular}.`
        : `Update ${article(resource.singular)} ${resource.singular} by id.`,
    examples: [
      ...(example ? [`${command} ${example} --json`] : []),
      `${command} --data '{...}' --json`,
      `${command} --file ${exampleFile(resource.singular)}`,
    ],
    flags: {
      ...bodyFieldFlags(fields),
      ...rawBodyFlags(document, fields),
      ...options.flags,
    },
    args: verb === "create" ? {} : idArg(resource, topic),
  };
};

/** What a write without a body to send is refused for. */
const NEEDS_BODY_REFUSAL: Refusal = {
  message: "{command} needs a body",
  hint: "Pass the body's fields as flags (see `{command} --help`), --set <path>=<value>, or --data '<json>' / --file <path>.",
};

const givesBody = (flags: Json, fields: readonly BodyField[]): boolean => {
  return (
    flags.data !== undefined ||
    flags.file !== undefined ||
    (Array.isArray(flags.set) && flags.set.length > 0) ||
    fields.some((field) => {
      return field.flag !== undefined && flags[named(field.flag)] !== undefined;
    })
  );
};

type WriteInput = OperationInput<
  Json,
  Record<string, string>,
  Readonly<{
    body: Json;
  }>
>;

abstract class WriteOperation<
  Ctx,
  Spec extends WriteShape & { readonly schema: CreateSpec<Ctx>["schema"] },
> extends ResourceCommand<Ctx, Spec, WriteInput> {
  protected abstract verb: "create" | "update";

  protected override async operate({ args, flags }: WriteInput): Promise<CommandResult> {
    const { topic, spec, resource, options } = this.definition;
    const fields = fieldsOf(spec, options);
    if (!givesBody(flags, fields)) {
      throw refusalError(NEEDS_BODY_REFUSAL, {
        command: `${topic} ${this.verb}`,
      });
    }
    const body = await resourceBody(
      {
        topic,
        verb: this.verb,
        root: spec.root,
        schema: spec.schema,
        document: documentSchemaOf(spec.schema, spec.root),
        fields,
        references: options.references,
      },
      flags,
    );
    const idKey = named(idName(resource));
    const id = typeof args[idKey] === "string" ? (args[idKey] as string) : undefined;
    if (this.dryRun) {
      return dryRunResult({
        verb: this.verb,
        topic,
        noun: resource.singular,
        id,
        body,
        checked: (await this.check(body, id)) ?? undefined,
        context: {
          schema: spec.schema as ZodLike,
          references: options.references,
        },
      });
    }

    // Some writes answer without a body (`grants create` by identifier answers
    // 202), so there is no record to get, and `data` is still an object.
    const result = await this.send(await this.context(), body, id);
    let summary: Summary = {
      title: "Command completed",
      sections: [],
    };
    if (result !== undefined) {
      summary = {
        title: `${this.verb === "create" ? "Created" : "Updated"} ${resource.singular} ${escapeControlCharacters(String(resource.idOf(result)), { keepLayout: false })}`,
        sections: [],
        lines: escapeJsonControlCharacters(JSON.stringify(result, null, 2)).split("\n"),
      };
    }

    return {
      status: "ok",
      data: result ?? {},
      // A write that answered no body has no record to print, so it keeps the
      // generic rendering that says the command completed. Printing `{}` would
      // be the record the write did not make.
      ...(result === undefined || this.isOnScreen ? {} : { pretty: json(result) }),
      summary,
      ...(result && resource.get
        ? {
            next: {
              commands: [
                this.suggest(`${topic} get ${Cmd.quote(String(resource.idOf(result)))} --json`),
              ],
            },
          }
        : {}),
    };
  }

  protected abstract send(ctx: Ctx, body: Json, id: string | undefined): Promise<WriteResult>;

  /** The server's answer to a dry run of this write, where it can give one. */
  protected check(_body: Json, _id: string | undefined): Promise<WriteResult> {
    return Promise.resolve(undefined);
  }
}

/** `<topic> create`. */
export class CreateOperation<Ctx> extends WriteOperation<Ctx, CreateSpec<Ctx>> {
  static describe<Ctx>(definition: OperationDefinition<Ctx, CreateSpec<Ctx>>): OperationStatics {
    return describeWrite(definition, definition.options, "create");
  }

  protected readonly verb = "create";

  protected send(ctx: Ctx, body: Json): Promise<WriteResult> {
    return this.definition.spec.call(ctx, body);
  }
}

/** `<topic> update <id>`. */
export class UpdateOperation<Ctx> extends WriteOperation<Ctx, UpdateSpec<Ctx>> {
  static describe<Ctx>(definition: OperationDefinition<Ctx, UpdateSpec<Ctx>>): OperationStatics {
    return describeWrite(definition, definition.options, "update");
  }

  protected readonly verb = "update";

  protected send(ctx: Ctx, body: Json, id: string | undefined): Promise<WriteResult> {
    return this.definition.spec.call(ctx, id ?? "", body);
  }

  protected override async check(body: Json, id: string | undefined): Promise<WriteResult> {
    const { check } = this.definition.spec;

    return check === undefined ? undefined : check(await this.context(), id ?? "", body);
  }
}

export type { ResourceDescriptor };
