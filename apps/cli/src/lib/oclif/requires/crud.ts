import { ZitadelError } from "../../errors";
import { isObject } from "../../json";
import { type Assignment, fragmentOf } from "../crud/assign";
import { readRawBody } from "../crud/body";
import { mergeDocuments, setAt, valueAt } from "../crud/document";
import { type BodyField, bodyFromFlags } from "../crud/fields";
import { findCredential, refuseSecret, type References } from "../crud/secrets";
import { parseOrThrow } from "../crud/shared";
import type { Json, Schema } from "../crud/types";
import { objectOf, type ZodLike } from "../crud/zod";
import { requirement } from "../requirements";

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
 * The body of a write: the document from `--data`, `--file` or stdin, the field
 * flags and each `--set` merged over it in that order, checked for credentials
 * on the command line, for the fields it must carry, and against the request
 * schema, so a command is handed a body that is ready to send.
 */
export const resourceBody = (source: ResourceBodySource) => {
  return requirement<Json>({
    resolve: async ({ flags }) => {
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
        throw new ZitadelError(
          "E_VALIDATION",
          `${source.topic} ${source.verb} is missing required ${missing.length === 1 ? "field" : "fields"}: ${flagNames.join(", ")}`,
          {
            hint: `Pass ${flagNames.join(" and ")}, or include ${missing.length === 1 ? "it" : "them"} in --data / --file. See \`${source.topic} ${source.verb} --help\`.`,
            details: {
              missing: missing.map((field) => field.name),
            },
          },
        );
      }
      const wrapped = source.root === undefined ? merged : { [source.root]: merged };
      return parseOrThrow(source.schema, wrapped, "Body does not match the API schema") as Json;
    },
  });
};
