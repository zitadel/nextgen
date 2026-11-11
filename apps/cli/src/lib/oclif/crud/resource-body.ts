import { isObject } from "@/lib/json";
import { refusalError, type Refusal } from "@/lib/oclif/refusal";
import { type Assignment, fragmentOf } from "./assign";
import { readRawBody } from "./body";
import { mergeDocuments, setAt, valueAt } from "./document";
import { type BodyField, bodyFromFlags } from "./fields";
import { findCredential, refuseSecret, type References } from "./secrets";
import { parseOrThrow } from "./shared";
import type { Json, Schema } from "./types";
import { objectOf, type ZodLike } from "./zod";

type ArgvPart = Readonly<{ value: unknown; source: string }>;

const argvParts = (
  flags: Json,
  base: Json | undefined,
  fields: readonly BodyField[],
  fromFlags: Json | undefined,
  assignments: readonly Assignment[],
): ArgvPart[] => [
  ...(typeof flags.data === "string" && base
    ? [
        {
          value: base,
          source: "--data",
        },
      ]
    : []),
  ...fields.flatMap((field) => {
    const value = valueAt(fromFlags, field.path);
    return value === undefined || field.flag === undefined
      ? []
      : [
          {
            value: setAt({}, field.path, value),
            source: `--${field.flag}`,
          },
        ];
  }),
  ...assignments.map((assignment) => ({
    value: fragmentOf(assignment),
    source: "--set",
  })),
];

const refuseArgvCredentials = (
  parts: readonly ArgvPart[],
  schema: ZodLike | undefined,
  references: References | undefined,
): void => {
  for (const part of parts) {
    const credential = findCredential(part.value, {
      schema,
      references,
    });
    if (credential) {
      refuseSecret(credential.key, part.source, {
        references,
        path: credential.path,
      });
    }
  }
};

const unwrapRoot = (raw: Json, root: string | undefined, document: ZodLike | undefined): Json => {
  if (root === undefined || !Object.hasOwn(raw, root) || Object.keys(raw).length !== 1) {
    return raw;
  }
  const inner = raw[root];
  const shape = objectOf(document)?.shape;
  const declared = shape !== undefined && Object.hasOwn(shape, root);
  return isObject(inner) && !declared ? inner : raw;
};

const isMissing = (field: BodyField, document: unknown): boolean =>
  valueAt(document, field.path) === undefined &&
  (field.required ||
    (field.requiredWith !== undefined && isObject(valueAt(document, field.requiredWith))));

const spelling = (field: BodyField): string =>
  field.flag ? `--${field.flag}` : `--set ${field.name}=…`;

/** What {@link resourceBody} builds a write's body from. */
export type ResourceBodySource = Readonly<{
  topic: string;
  verb: "create" | "update";
  root: string | undefined;
  schema: Schema;
  document: ZodLike | undefined;
  fields: readonly BodyField[];
  references: References | undefined;
}>;

/**
 * The body of a write, read from the flags: the document from `--data`, `--file` or stdin, the field
 * flags and each `--set` merged over it in that order, checked for credentials
 * on the command line, for the fields it must carry, and against the request
 * schema, so a command is handed a body that is ready to send.
 */
const MISSING_FIELDS_REFUSAL: Refusal = {
  message: "{command} is missing required {noun}: {spellings}",
  hint: "Pass {alternatives}, or include {pronoun} in --data / --file. See `{command} --help`.",
  details: {
    missing: "{names}",
  },
};

export const resourceBody = async (source: ResourceBodySource, flags: Json): Promise<Json> => {
  const raw = await readRawBody(flags, `${source.topic} ${source.verb}`);
  const base = raw === undefined ? undefined : unwrapRoot(raw, source.root, source.document);
  const fromFlags = bodyFromFlags(source.fields, flags);
  const assignments = (flags.set ?? []) as readonly Assignment[];
  refuseArgvCredentials(
    argvParts(flags, base, source.fields, fromFlags, assignments),
    source.document,
    source.references,
  );
  const merged = [fromFlags, ...assignments.map(fragmentOf)].reduce<unknown>(
    (body, overlay) => (overlay === undefined ? body : mergeDocuments(body, overlay)),
    base ?? {},
  );
  const missing = source.fields.filter((field) => isMissing(field, merged));
  if (missing.length > 0) {
    const flagNames = missing.map(spelling);
    throw refusalError(MISSING_FIELDS_REFUSAL, {
      command: `${source.topic} ${source.verb}`,
      noun: missing.length === 1 ? "field" : "fields",
      pronoun: missing.length === 1 ? "it" : "them",
      spellings: flagNames.join(", "),
      alternatives: flagNames.join(" and "),
      names: missing.map((field) => field.name),
    });
  }
  const wrapped = source.root === undefined ? merged : { [source.root]: merged };
  return parseOrThrow(source.schema, wrapped, "Body does not match the API schema") as Json;
};
