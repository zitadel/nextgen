import { Flags, type Interfaces } from "@oclif/core";

import { ZitadelError } from "../../errors";
import { isObject } from "../../json";
import { isSecretKey, refuseSecret } from "./secrets";
import type { Json, Schema } from "./types";

/**
 * Body fields as CLI flags. A registry entry already carries the generated
 * request schema, and that schema knows every field's name, type, whether it
 * is required, and its allowed values — so `create` and `update` expose one
 * flag per field instead of only a raw `--data '{…}'` blob. Whatever cannot
 * be expressed as a single flag (a nested object, an array) stays reachable
 * through `--data` / `--file`; an open record (a user's `attributes`) gets a
 * repeatable `key=value` flag.
 *
 * Introspection is defensive: an unrecognised schema yields no fields, and
 * the command falls back to the raw-body flags alone.
 */

/** How a field is rendered on the command line. */
export type FieldKind = "string" | "number" | "boolean" | "enum" | "record";

export type BodyField = Readonly<{
  /** Property name on the wire (`principal_type`). */
  name: string;
  /** Flag name as typed (`principal-type`). */
  flag: string;
  kind: FieldKind;
  required: boolean;
  /** Closed value set, for `enum` fields. */
  options?: readonly string[];
  /** One-line summary of the schema's description, used as flag help. */
  summary: string;
}>;

/** Flags the write commands own; a body field of the same name stays raw-body only. */
const RESERVED = new Set(["data", "file", "json", "cwd", "server", "force", "environment", "help"]);

const kebab = (name: string): string => name.replaceAll("_", "-");

/**
 * One-line flag help from a schema description: newlines collapsed, the first
 * sentence kept, and long prose trimmed at a word boundary so `--help` stays a
 * table rather than a paragraph.
 */
const summarize = (description: string | undefined): string => {
  const text = (description ?? "").replaceAll(/\s+/g, " ").trim();
  const sentence = /^(.+?\.)(?:\s|$)/.exec(text)?.[1] ?? text;
  if (sentence.length <= 110) {
    return sentence;
  }
  const clipped = sentence.slice(0, 110);
  return `${clipped.slice(0, clipped.lastIndexOf(" "))}…`;
};

type ZodLike = {
  def?: { type?: string; innerType?: ZodLike };
  options?: readonly string[];
  description?: string;
};

/** Peel `optional` / `default` / `nullable` wrappers off a field. */
const unwrap = (field: ZodLike): ZodLike => {
  let type = field;
  while (
    type?.def?.innerType &&
    ["optional", "default", "nullable"].includes(type.def.type ?? "")
  ) {
    type = type.def.innerType;
  }
  return type;
};

const kindOf = (type: ZodLike): FieldKind | undefined => {
  switch (type?.def?.type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "enum":
      return "enum";
    case "record":
      return "record";
    // A union of string|null (a clearable field) reads as a plain string flag.
    case "union":
      return "string";
    default:
      return undefined;
  }
};

/**
 * Read the body fields of a generated request schema. Returns an empty list
 * for anything that is not a plain object schema, so the caller degrades to
 * `--data` / `--file`.
 */
export const describeBody = (schema: Schema): readonly BodyField[] => {
  const shape = (schema as { shape?: Record<string, ZodLike> }).shape;
  if (!isObject(shape)) {
    return [];
  }
  return Object.entries(shape).flatMap(([name, field]): BodyField[] => {
    const flag = kebab(name);
    if (RESERVED.has(flag)) {
      return [];
    }
    const kind = kindOf(unwrap(field));
    if (!kind) {
      return [];
    }
    const options = kind === "enum" ? unwrap(field).options : undefined;
    return [
      {
        name,
        flag,
        kind,
        required: !schemaAccepts(schema, name),
        ...(options ? { options } : {}),
        summary: summarize(field.description ?? unwrap(field).description),
      },
    ];
  });
};

/** Whether the schema accepts a body that omits `name` — i.e. the field is optional. */
const schemaAccepts = (schema: Schema, name: string): boolean => {
  const probe = schema.safeParse({});
  if (probe.success) {
    return true;
  }
  const issues = (probe.error?.issues ?? []) as Array<{ path?: unknown[] }>;
  return !issues.some((issue) => issue.path?.length === 1 && issue.path[0] === name);
};

/** oclif flags for the given fields, grouped so `--help` separates required from optional. */
export const bodyFieldFlags = (fields: readonly BodyField[]): Interfaces.FlagInput =>
  Object.fromEntries(
    fields.map((field) => {
      // oclif orders help groups by their first flag alphabetically, so the
      // required marker also rides in the description rather than relying on
      // the group heading coming first.
      const helpGroup = field.required ? "REQUIRED FIELD" : "OPTIONAL FIELD";
      const description = [
        field.required ? "(required)" : "",
        field.kind === "record"
          ? `Repeatable ${field.name} entry: key=value for a string, key:=value for JSON.`
          : "",
        field.summary,
      ]
        .filter(Boolean)
        .join(" ");
      if (field.kind === "boolean") {
        return [field.flag, Flags.boolean({ description, helpGroup })];
      }
      if (field.kind === "number") {
        return [field.flag, Flags.integer({ description, helpGroup })];
      }
      if (field.kind === "record") {
        return [field.flag, Flags.string({ description, helpGroup, multiple: true })];
      }
      return [
        field.flag,
        Flags.string({
          description,
          helpGroup,
          ...(field.options ? { options: [...field.options] } : {}),
        }),
      ];
    }),
  );

/**
 * Build the body fragment the field flags describe. Returns `undefined` when
 * no field flag was given, so the caller can tell "no body at all" from
 * "a body made of flags".
 */
export const bodyFromFlags = (fields: readonly BodyField[], flags: Json): Json | undefined => {
  const collected = fields.flatMap((field): Array<[string, unknown]> => {
    const value = flags[field.flag];
    if (value === undefined) {
      return [];
    }
    if (field.kind === "record") {
      const pairs = (Array.isArray(value) ? value : [value]).map((entry) =>
        parsePair(String(entry), field.flag),
      );
      return [[field.name, Object.fromEntries(pairs)]];
    }
    return [[field.name, value]];
  });
  return collected.length > 0 ? Object.fromEntries(collected) : undefined;
};

/**
 * One entry of a repeatable record flag.
 *
 * `key=value` is always a string, so an identifier that looks numeric (a postal
 * code, a phone number) survives intact. `key:=value` parses the value as JSON,
 * which is how a field the customer's schema declares as a number, a boolean,
 * null, an array, or an object is set — the same split HTTPie uses. Keeping the
 * two explicit means the CLI never has to guess which one was meant.
 */
const parsePair = (raw: string, flag: string): readonly [string, unknown] => {
  const json = raw.indexOf(":=");
  const plain = raw.indexOf("=");
  const hint = `Use --${flag} key=value for a string, or key:=value for JSON (e.g. --${flag} age:=30).`;
  if (json > 0 && json === plain - 1) {
    const key = secretChecked(raw.slice(0, json), flag);
    const value = raw.slice(json + 2);
    try {
      return [key, JSON.parse(value) as unknown];
    } catch {
      throw new ZitadelError("E_VALIDATION", `--${flag} ${key}:= expects JSON, got "${value}"`, {
        hint: `Quote a JSON value, e.g. --${flag} ${key}:=30, ${key}:=true, or ${key}:='{"a":1}'. For a plain string use ${key}=${value}.`,
      });
    }
  }
  if (plain <= 0) {
    throw new ZitadelError("E_VALIDATION", `Invalid --${flag} "${raw}"`, { hint });
  }
  return [secretChecked(raw.slice(0, plain), flag), raw.slice(plain + 1)];
};

/** One example invocation using the required fields, for a command's `examples`. */
export const fieldExample = (fields: readonly BodyField[]): string | undefined => {
  const required = fields.filter((field) => field.required);
  if (required.length === 0) {
    return undefined;
  }
  return required
    .map((field) =>
      field.kind === "record"
        ? `--${field.flag} <key>=<value>`
        : `--${field.flag} ${field.options ? field.options[0] : `<${field.name}>`}`,
    )
    .join(" ");
};


/** A record key, refused when it names a credential. */
const secretChecked = (key: string, flag: string): string =>
  isSecretKey(key) ? refuseSecret(key, `--${flag}`) : key;
