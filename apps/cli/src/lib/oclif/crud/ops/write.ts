import { Flags } from "@oclif/core";

import { ZitadelError } from "../../../errors";
import { isObject } from "../../../json";
import { publicCliCommand } from "../../../public-cli";
import type { CommandResult, GlobalOptions } from "../../types";
import { readRawBody } from "../body";
import { bodyFieldFlags, bodyFromFlags, describeBody, fieldExample } from "../fields";
import { dryRunResult, idArg, parseOrThrow } from "../shared";
import type {
  CreateSpec,
  Json,
  ResourceCommandOptions,
  ResourceDescriptor,
  UpdateSpec,
} from "../types";
import {
  type OperationDefinition,
  type OperationInput,
  type OperationStatics,
  ResourceCommand,
} from "./command";

/** `--data` / `--file`: the whole body at once, for anything the field flags cannot express. */
const rawBodyFlags = {
  data: Flags.string({
    // No `-d`: the CLI conventions reserve that short form for `--debug`.
    description: "Whole body as a JSON object, instead of the field flags.",
    exclusive: ["file"],
    helpGroup: "RAW BODY",
  }),
  file: Flags.string({
    description: "Read the body from a JSON file; `-` reads stdin.",
    exclusive: ["data"],
    helpGroup: "RAW BODY",
  }),
};

/**
 * `<topic> create` and `<topic> update <id>` share everything but the id
 * argument. The body comes from one flag per schema field, from `--data` /
 * `--file`, or from both — a field flag overrides the same key in the raw
 * body. It is validated against the request schema before the call, and the
 * resource is echoed back with a `next_commands` hint at the matching `get`.
 */
const describeWrite = <Ctx, Spec extends { readonly schema: CreateSpec<Ctx>["schema"] }>(
  { topic, resource, spec }: OperationDefinition<Ctx, Spec>,
  options: ResourceCommandOptions<Ctx>,
  verb: "create" | "update",
): OperationStatics => {
  const fields = describeBody(spec.schema);
  const example = fieldExample(fields);
  const target = verb === "create" ? topic : `${topic} update <id>`;
  return {
    description:
      verb === "create" ? `Create a ${resource.singular}.` : `Update a ${resource.singular} by id.`,
    examples: [
      ...(example
        ? [`<%= config.bin %> ${target.replace(topic, `${topic} ${verb}`)} ${example} --json`]
        : []),
      `<%= config.bin %> ${topic} ${verb}${verb === "update" ? " <id>" : ""} --data '{...}' --json`,
      `<%= config.bin %> ${topic} ${verb}${verb === "update" ? " <id>" : ""} --file ./${resource.singular}.json`,
    ],
    flags: { ...bodyFieldFlags(fields), ...rawBodyFlags, ...options.flags },
    args: verb === "create" ? {} : idArg(resource),
  };
};

abstract class WriteOperation<
  Ctx,
  Spec extends { readonly schema: CreateSpec<Ctx>["schema"] },
> extends ResourceCommand<Ctx, Spec> {
  protected abstract verb: "create" | "update";

  protected override async execute(
    { flags, args }: OperationInput,
    meta: GlobalOptions,
  ): Promise<CommandResult> {
    const { topic, resource, spec } = this.definition;
    const id = typeof args.id === "string" ? args.id : undefined;

    const raw = await readRawBody(flags, `${topic} ${this.verb}`);
    // A field flag wins over the same key in --data / --file.
    const fields = describeBody(spec.schema);
    const fromFlags = bodyFromFlags(fields, flags);
    if (!raw && !fromFlags) {
      throw new ZitadelError("E_VALIDATION", `${topic} ${this.verb} needs a body`, {
        hint: `Pass the body's fields as flags (see \`${topic} ${this.verb} --help\`), or --data '<json>' / --file <path>.`,
      });
    }
    // Required fields are not oclif-required — `--data` / `--file` may carry
    // them — so presence is checked here, once both sources are merged, and
    // reported as the flags the caller is missing rather than as schema issues.
    const merged = { ...raw, ...fromFlags };
    const missing = fields.filter((field) => field.required && merged[field.name] === undefined);
    if (missing.length > 0) {
      const flagNames = missing.map((field) => `--${field.flag}`);
      throw new ZitadelError(
        "E_VALIDATION",
        `${topic} ${this.verb} is missing required ${missing.length === 1 ? "field" : "fields"}: ${flagNames.join(", ")}`,
        {
          hint: `Pass ${flagNames.join(" and ")}, or include ${missing.length === 1 ? "it" : "them"} in --data / --file. See \`${topic} ${this.verb} --help\`.`,
          details: { missing: missing.map((field) => field.name) },
        },
      );
    }
    const body = parseOrThrow(spec.schema, merged, "Body does not match the API schema");
    if (meta.dryRun) {
      return dryRunResult(this.verb, topic, id, body);
    }

    const result = await this.send(await this.connect(meta), body, id);
    const resultId = isObject(result) ? result[resource.idField] : undefined;
    const nextCommands =
      typeof resultId === "string" && resource.get
        ? [publicCliCommand(`${topic} get ${resultId} --json`, meta.cliVersion)]
        : [];
    return {
      status: "ok",
      data:
        isObject(result) && nextCommands.length > 0
          ? { ...result, next_commands: nextCommands }
          : result,
      pretty: JSON.stringify(result, null, 2),
    };
  }

  protected abstract send(ctx: Ctx, body: Json, id: string | undefined): Promise<unknown>;
}

/** `<topic> create`. */
export class CreateOperation<Ctx> extends WriteOperation<Ctx, CreateSpec<Ctx>> {
  static describe<Ctx>(definition: OperationDefinition<Ctx, CreateSpec<Ctx>>): OperationStatics {
    return describeWrite(definition, definition.options, "create");
  }

  protected readonly verb = "create";

  protected send(ctx: Ctx, body: Json): Promise<unknown> {
    return this.definition.spec.call(ctx, body);
  }
}

/** `<topic> update <id>`. */
export class UpdateOperation<Ctx> extends WriteOperation<Ctx, UpdateSpec<Ctx>> {
  static describe<Ctx>(definition: OperationDefinition<Ctx, UpdateSpec<Ctx>>): OperationStatics {
    return describeWrite(definition, definition.options, "update");
  }

  protected readonly verb = "update";

  protected send(ctx: Ctx, body: Json, id: string | undefined): Promise<unknown> {
    return this.definition.spec.call(ctx, id ?? "", body);
  }
}

export type { ResourceDescriptor };
