import { nonBlankString } from "../../flags";

import { refuses } from "../../rules";
import { resourceBody } from "../../requires/crud";
import type { CommandResult } from "../../types";
import {
  type BodyField,
  bodyFieldFlags,
  describeBody,
  documentSchemaOf,
  fieldExample,
  flagsAloneMayBeIncomplete,
} from "../fields";
import { setFlag } from "../inputs";
import { article, dryRunResult, idArg, idName } from "../shared";
import type {
  CreateSpec,
  Json,
  ResourceCommandOptions,
  ResourceDescriptor,
  UpdateSpec,
  WriteResult,
  WriteShape,
} from "../types";
import type { ZodLike } from "../zod";
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
    set: setFlag({
      description:
        'Set one field by its dot path: path=value, or path:=json for JSON. Repeatable; applied after the field flags, in order. A key that contains a dot is set through its parent: --set \'parent:={"a.b":"x"}\'.',
      multiple: true,
      helpGroup: "RAW BODY",
      document,
      fields,
    }),
  };
};

/** A write's fields, read the same way for its `--help` and for a run. */
const fieldsOf = <Ctx>(
  spec: WriteShape & { schema: CreateSpec<Ctx>["schema"] },
  options: ResourceCommandOptions<Ctx>,
) => describeBody(spec.schema, { root: spec.root, reserved: Object.keys(options.flags ?? {}) });

/**
 * The `--file` example's file name, the singular as one shell word:
 * `./identity-provider-connection.json`, where the singular itself would be
 * split by a shell into three arguments.
 */
const exampleFile = (singular: string): string =>
  `./${singular.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.json`;

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
    flags: { ...bodyFieldFlags(fields), ...rawBodyFlags(document, fields), ...options.flags },
    args: verb === "create" ? {} : idArg(resource),
    rules: [
      refuses((view) => !givesBody(view.flags, fields), {
        message: `${topic} ${verb} needs a body`,
        hint: `Pass the body's fields as flags (see \`${topic} ${verb} --help\`), --set <path>=<value>, or --data '<json>' / --file <path>.`,
      }),
    ],
    requires: {
      body: resourceBody({
        topic,
        verb,
        root: spec.root,
        schema: spec.schema,
        document,
        fields,
        references: options.references,
      }),
    },
  };
};

const givesBody = (flags: Json, fields: readonly BodyField[]): boolean => {
  const set = flags.set;
  return (
    flags.data !== undefined ||
    flags.file !== undefined ||
    (Array.isArray(set) && set.length > 0) ||
    fields.some((field) => field.flag !== undefined && flags[field.flag] !== undefined)
  );
};

abstract class WriteOperation<
  Ctx,
  Spec extends WriteShape & { readonly schema: CreateSpec<Ctx>["schema"] },
> extends ResourceCommand<Ctx, Spec> {
  protected abstract verb: "create" | "update";

  protected override async operate({
    args,
    body,
  }: OperationInput & Readonly<{ body: Json }>): Promise<CommandResult> {
    const { topic, resource, spec, options } = this.definition;
    const idKey = idName(resource);
    const id = typeof args[idKey] === "string" ? (args[idKey] as string) : undefined;
    if (this.meta.dryRun) {
      return dryRunResult(this.verb, topic, id, body, {
        schema: spec.schema as ZodLike,
        references: options.references,
      });
    }

    // Some writes answer without a body (`grants create` by identifier answers
    // 202), so there is no record to get, and `data` is still an object.
    const result = await this.send(await this.context(), body, id);
    return {
      status: "ok",
      data: result ?? {},
      ...(result && resource.get
        ? {
            next: {
              commands: [this.suggest(`${topic} get ${String(resource.idOf(result))} --json`)],
            },
          }
        : {}),
      pretty: JSON.stringify(result, null, 2),
      machineReadable: true,
    };
  }

  protected abstract send(ctx: Ctx, body: Json, id: string | undefined): Promise<WriteResult>;
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
}

export type { ResourceDescriptor };
