import { Flags, type Interfaces } from "@oclif/core";

import { type Assignment, readAssignment } from "@/cli/core/crud/assign";
import {
  type BodyField,
  bodyFieldFlags,
  describeBody,
  documentSchemaOf,
  fieldExample,
  flagsAloneMayBeIncomplete,
} from "@/cli/core/crud/fields";
import type { Admitted, BaseCommand, Facts } from "@/cli/core/base";
import { Destructive } from "@/cli/core/destructive";
import { Previewable } from "@/cli/core/previewable";
import { resourceBody } from "@/cli/core/crud/resource-body";
import { article, dryRunResult, idArg, idName } from "@/cli/core/crud/shared";
import type {
  CreateSpec,
  Json,
  ResourceCommandOptions,
  UpdateSpec,
  WriteResult,
  WriteShape,
} from "@/cli/core/crud/types";
import type { ZodLike } from "@/cli/core/crud/zod";
import { nonBlankString } from "@/cli/core/flags";
import { named } from "@/lib/names";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { helpOf } from "@/lib/suggestion";
import type { CommandResult } from "@/cli/core/types";
import { resourceSuggestion } from "@/lib/suggestion";
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
 *
 * A merge-patch removes what it sets to `null`, so an update is `Destructive`
 * and takes `--force`, its way past the confirmation a deletion is asked for.
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
    ...(verb === "update"
      ? {
          force:
            "Remove the fields set to null without the confirmation prompt. Required when non-interactive.",
        }
      : {}),
    flags: {
      ...bodyFieldFlags(fields),
      ...rawBodyFlags(document, fields),
      ...options.flags,
    },
    args: verb === "create" ? {} : idArg(resource, topic),
  };
};

/** What a write without a body to send is refused for. */
const NEEDS_BODY_REFUSAL = {
  message: "{command} needs a body",
  hint: "Pass the body's fields as flags (the help below lists them), --set <path>=<value>, or --data '<json>' / --file <path>.",
  next: ["{help}"],
} as const satisfies Refusal;

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

/** The spec every write has, whichever verb it is. */
type WrittenSpec = WriteShape & { readonly schema: CreateSpec<unknown>["schema"] };

/** What a write found out before it did anything: the body it would send and what it would remove. */
type Intent = Readonly<{
  /** The body the write would send. */
  body: Json;
  /** The id of the record it writes, when the verb names one. */
  id: string | undefined;
  /** The fields a merge-patch sets to `null`, which the write removes. */
  removed: readonly string[];
  /** What the removal is called in the question and the warning. */
  what: string;
}>;

abstract class WriteOperation extends Previewable(ResourceCommand) {
  protected abstract verb: "create" | "update";

  /**
   * A write is the verb it is.
   *
   * @returns `create` or `update`.
   */
  protected override get action(): string {
    return this.verb;
  }

  /**
   * The body this run sent, once it has.
   */
  private written: Json | undefined;

  /**
   * What the write knows about its run from the body it sent.
   *
   * @returns The facts the resource's write declares, with the layers below.
   */
  protected override describe(): Facts {
    return {
      ...super.describe(),
      ...(this.written === undefined
        ? {}
        : this.defined<unknown, WrittenSpec>().spec.facts?.(this.written)),
    };
  }

  /**
   * Reads what the write would do from the command line, which a dry run and
   * the real run both start from: the body it would send, the id it names and
   * the fields it would remove.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns What the write intends.
   * @throws {ZitadelError} When the command line gives no body, or one the schema refuses.
   */
  protected async intended(input: Admitted<typeof BaseCommand>): Promise<Intent> {
    const { args, flags } = input as OperationInput<Json, Record<string, string>>;
    const { topic, spec, resource, options } = this.defined<unknown, WrittenSpec>();
    const fields = fieldsOf(spec, options);
    if (!givesBody(flags, fields)) {
      throw refusalError(
        NEEDS_BODY_REFUSAL,
        { command: `${topic} ${this.verb}` },
        { help: helpOf(`${topic}:${this.verb}`) },
      );
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
        retry: await this.rerun<{
          file: Interfaces.OptionFlag<string | undefined>;
          data: Interfaces.OptionFlag<string | undefined>;
        }>({
          with: { file: "<path>" },
          without: ["data"],
        }),
      },
      flags,
    );
    const idKey = named(idName(resource));
    const id = typeof args[idKey] === "string" ? (args[idKey] as string) : undefined;
    const removed: string[] = [];
    if (this.verb === "update") {
      JSON.stringify(body, function (key, value) {
        if (value === null && key !== "" && !Array.isArray(this)) {
          removed.push(key);
        }

        return value;
      });
    }

    return {
      body,
      id,
      removed,
      what: `${removed.join(", ")} from ${resource.singular} ${id ?? ""}`.trim(),
    };
  }

  /**
   * What the write would do, checked against the server where it can be, and
   * the run that does it, suggested with `--force` when it removes fields.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The envelope of the dry run.
   */
  protected override async preview(input: Admitted<typeof BaseCommand>): Promise<CommandResult> {
    const { body, id, removed, what } = await this.intended(input);
    const { topic, spec, resource, options } = this.defined<unknown, WrittenSpec>();

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
      warnings: removed.length === 0 ? [] : [`The real run removes ${what}`],
      next:
        removed.length === 0
          ? await this.realRun()
          : await this.rerun<{
              force: Interfaces.BooleanFlag<boolean>;
              dryRun: Interfaces.BooleanFlag<boolean>;
            }>({
              with: { force: true },
              without: ["dryRun"],
            }),
    });
  }

  /**
   * Sends the write and says what it made. Some writes answer without a body
   * (`grant create` by identifier answers 202), so there is no record to get,
   * and `data` is still an object. Such a write has no record to print, so it
   * keeps the generic rendering that says the command completed: printing `{}`
   * would be the record the write did not make.
   *
   * @param intent - What the write intends, from {@link intended}.
   * @returns The result of the write.
   */
  protected async commit({ body, id }: Intent): Promise<CommandResult> {
    const { topic, resource } = this.defined<unknown, WrittenSpec>();
    this.written = body;
    const result = await this.send(await this.context<unknown>(), body, id);
    const summary: Summary =
      result === undefined
        ? {
            title: "Command completed",
            sections: [],
          }
        : {
            title: `${this.verb === "create" ? "Created" : "Updated"} ${resource.singular} ${escapeControlCharacters(String(resource.idOf(result)), { keepLayout: false })}`,
            sections: [],
            lines: escapeJsonControlCharacters(JSON.stringify(result, null, 2)).split("\n"),
          };

    return {
      status: "ok",
      data: result ?? {},
      summary,
      ...(result && resource.get
        ? {
            next: {
              commands: [
                this.suggest(
                  resourceSuggestion(topic, "get", {
                    args: { [named(idName(resource))]: String(resource.idOf(result)) },
                    flags: { json: true },
                  }),
                ),
              ],
            },
          }
        : {}),
    };
  }

  /**
   * Does the write: it sends the body and ends the run with the record.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The envelope of the run.
   */
  protected override async apply(input: Admitted<typeof BaseCommand>): Promise<CommandResult> {
    return await this.commit(await this.intended(input));
  }

  protected abstract send(ctx: unknown, body: Json, id: string | undefined): Promise<WriteResult>;

  /** The server's answer to a dry run of this write, where it can give one. */
  protected check(_body: Json, _id: string | undefined): Promise<WriteResult> {
    return Promise.resolve(undefined);
  }
}

/** `<topic> create`. */
export abstract class CreateOperation<Ctx> extends WriteOperation {
  static describe<Ctx>(definition: OperationDefinition<Ctx, CreateSpec<Ctx>>): OperationStatics {
    return describeWrite(definition, definition.options, "create");
  }

  protected readonly verb = "create";

  protected send(ctx: Ctx, body: Json): Promise<WriteResult> {
    return this.defined<Ctx, CreateSpec<Ctx>>().spec.call(ctx, body);
  }
}

/** `<topic> update <id>`. */
export abstract class UpdateOperation<Ctx> extends Destructive(WriteOperation) {
  static describe<Ctx>(definition: OperationDefinition<Ctx, UpdateSpec<Ctx>>): OperationStatics {
    return describeWrite(definition, definition.options, "update");
  }

  protected readonly verb = "update";

  protected send(ctx: Ctx, body: Json, id: string | undefined): Promise<WriteResult> {
    return this.defined<Ctx, UpdateSpec<Ctx>>().spec.call(ctx, id ?? "", body);
  }

  /**
   * Does the update. One that removes fields asks first, as a deletion does, and
   * ends as skipped when the answer is no.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The envelope of the run.
   */
  protected override async apply(input: Admitted<typeof BaseCommand>): Promise<CommandResult> {
    const intent = await this.intended(input);
    if (intent.removed.length === 0) {
      return await this.commit(intent);
    }

    return await this.confirmed({
      verb: "remove",
      name: `remove ${intent.what}`,
      message: `Remove ${intent.what}?`,
      apply: () => {
        return this.commit(intent);
      },
    });
  }

  protected override async check(body: Json, id: string | undefined): Promise<WriteResult> {
    const { check } = this.defined<Ctx, UpdateSpec<Ctx>>().spec;

    return check === undefined ? undefined : check(await this.context<Ctx>(), id ?? "", body);
  }
}
