import { Flags } from "@oclif/core";

import { nonBlankString } from "../../flags";

import { ZitadelError } from "../../../errors";
import { isObject } from "../../../json";
import type { CommandResult, GlobalOptions } from "../../types";
import { type Assignment, fragmentOf, readAssignments } from "../assign";
import { readRawBody } from "../body";
import { mergeDocuments, setAt, valueAt } from "../document";
import {
  type BodyField,
  bodyFieldFlags,
  bodyFromFlags,
  describeBody,
  documentSchemaOf,
  fieldExample,
  flagsAloneMayBeIncomplete,
} from "../fields";
import { findCredential, refuseSecret, type References } from "../secrets";
import { article, dryRunResult, idArg, idName, parseOrThrow } from "../shared";
import type {
  CreateSpec,
  Json,
  ResourceCommandOptions,
  ResourceDescriptor,
  UpdateSpec,
  WriteShape,
} from "../types";
import { objectOf, type ZodLike } from "../zod";
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
const rawBodyFlags = {
  data: nonBlankString({
    // No `-d`: the CLI conventions reserve that short form for `--debug`.
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
  set: Flags.string({
    description:
      'Set one field by its dot path: path=value, or path:=json for JSON. Repeatable; applied after the field flags, in order. A key that contains a dot is set through its parent: --set \'parent:={"a.b":"x"}\'.',
    multiple: true,
    helpGroup: "RAW BODY",
  }),
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
    flags: { ...bodyFieldFlags(fields), ...rawBodyFlags, ...options.flags },
    args: verb === "create" ? {} : idArg(resource),
  };
};

/** One part of the body that came in on the command line, and the flag it came through. */
type ArgvPart = Readonly<{ value: unknown; source: string }>;

/**
 * The parts of the body that came in on the command line, each with the flag
 * it came through. `--file` and stdin are not among them: those routes never
 * pass through argv, which is why the refusal points at them.
 */
const argvParts = (
  flags: Json,
  base: Json | undefined,
  fields: readonly BodyField[],
  fromFlags: Json | undefined,
  assignments: readonly Assignment[],
): ArgvPart[] => [
  ...(typeof flags.data === "string" && base ? [{ value: base, source: "--data" }] : []),
  ...fields.flatMap((field) => {
    const value = valueAt(fromFlags, field.path);
    return value === undefined || field.flag === undefined
      ? []
      : [{ value: setAt({}, field.path, value), source: `--${field.flag}` }];
  }),
  ...assignments.map((assignment) => ({ value: fragmentOf(assignment), source: "--set" })),
];

/**
 * Refuse a credential that reached the command line, through any flag that
 * carries part of the body. A reference to a variable is not one, nor is a
 * value the schema fixes (ADR 071 §7).
 */
const refuseArgvCredentials = (
  parts: readonly ArgvPart[],
  schema: ZodLike | undefined,
  references: References | undefined,
): void => {
  for (const part of parts) {
    const credential = findCredential(part.value, { schema, references });
    if (credential) {
      refuseSecret(credential.key, part.source, { references, path: credential.path });
    }
  }
};

/**
 * The document of a body that arrived still wrapped in its root
 * (`{"idp": {…}}`, as the API reference shows one). Unwrapped only when the
 * wrapper cannot be a field of the document itself.
 */
const unwrapRoot = (raw: Json, root: string | undefined, document: ZodLike | undefined): Json => {
  if (root === undefined || !Object.hasOwn(raw, root) || Object.keys(raw).length !== 1) {
    return raw;
  }
  const inner = raw[root];
  const shape = objectOf(document)?.shape;
  const declared = shape !== undefined && Object.hasOwn(shape, root);
  return isObject(inner) && !declared ? inner : raw;
};

/**
 * Whether a field the body must carry is missing: one every body carries, or
 * one whose optional object was given (`oidc.issuer` once anything under
 * `oidc` is).
 */
const isMissing = (field: BodyField, document: unknown): boolean =>
  valueAt(document, field.path) === undefined &&
  (field.required ||
    (field.requiredWith !== undefined && isObject(valueAt(document, field.requiredWith))));

/** How a missing field is named to the caller: its flag, or `--set` when it has none. */
const spelling = (field: BodyField): string =>
  field.flag ? `--${field.flag}` : `--set ${field.name}=…`;

abstract class WriteOperation<
  Ctx,
  Spec extends WriteShape & { readonly schema: CreateSpec<Ctx>["schema"] },
> extends ResourceCommand<Ctx, Spec> {
  protected abstract verb: "create" | "update";

  protected override async execute(
    { flags, args }: OperationInput,
    meta: GlobalOptions,
  ): Promise<CommandResult> {
    const { topic, resource, spec, options } = this.definition;
    const idKey = idName(resource);
    const id = typeof args[idKey] === "string" ? (args[idKey] as string) : undefined;
    const document = documentSchemaOf(spec.schema, spec.root);
    const fields = fieldsOf(spec, options);

    const raw = await readRawBody(flags, `${topic} ${this.verb}`);
    const base = raw === undefined ? undefined : unwrapRoot(raw, spec.root, document);
    const fromFlags = bodyFromFlags(fields, flags);
    const assignments = readAssignments(flags.set, document, fields);
    if (!base && !fromFlags && assignments.length === 0) {
      throw new ZitadelError("E_VALIDATION", `${topic} ${this.verb} needs a body`, {
        hint: `Pass the body's fields as flags (see \`${topic} ${this.verb} --help\`), --set <path>=<value>, or --data '<json>' / --file <path>.`,
      });
    }
    refuseArgvCredentials(
      argvParts(flags, base, fields, fromFlags, assignments),
      document,
      options.references,
    );

    // Each source merges over the one before (ADR 071 §1): a field flag over
    // the document changes the key it names, not the object around it.
    const merged = [fromFlags, ...assignments.map(fragmentOf)].reduce<unknown>(
      (body, overlay) => (overlay === undefined ? body : mergeDocuments(body, overlay)),
      base ?? {},
    );

    // Required fields are not oclif-required — `--data` / `--file` may carry
    // them — so presence is checked here, once every source is merged, and
    // reported as the flags the caller is missing rather than as schema issues.
    const missing = fields.filter((field) => isMissing(field, merged));
    if (missing.length > 0) {
      const flagNames = missing.map(spelling);
      throw new ZitadelError(
        "E_VALIDATION",
        `${topic} ${this.verb} is missing required ${missing.length === 1 ? "field" : "fields"}: ${flagNames.join(", ")}`,
        {
          hint: `Pass ${flagNames.join(" and ")}, or include ${missing.length === 1 ? "it" : "them"} in --data / --file. See \`${topic} ${this.verb} --help\`.`,
          details: { missing: missing.map((field) => field.name) },
        },
      );
    }
    const wrapped = spec.root === undefined ? merged : { [spec.root]: merged };
    const body = parseOrThrow(spec.schema, wrapped, "Body does not match the API schema");
    if (meta.dryRun) {
      return dryRunResult(this.verb, topic, id, body, {
        schema: spec.schema as ZodLike,
        references: options.references,
      });
    }

    const result = await this.send(await this.context(), body, id);
    const resultId = isObject(result) ? result[resource.idField] : undefined;
    return {
      status: "ok",
      // An ok envelope always carries `data`, also when the server accepts a
      // write without a body (`grants create` by identifier answers 202).
      data: result ?? {},
      ...(typeof resultId === "string" && resource.get
        ? { next: { commands: [this.suggest(`${topic} get ${resultId} --json`)] } }
        : {}),
      pretty: JSON.stringify(result, null, 2),
      machineReadable: true,
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
