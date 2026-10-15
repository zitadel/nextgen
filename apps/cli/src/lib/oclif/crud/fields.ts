import { Flags, type Interfaces } from "@oclif/core";

import { ZitadelError } from "../../errors";
import { jsonValue, setAt, typedValue } from "./document";
import type { Json, Schema } from "./types";
import {
  defaultOf,
  fieldOf,
  isInteger,
  isOptionalField,
  objectOf,
  unwrap,
  type ZodLike,
} from "./zod";

/**
 * Body fields as CLI flags. A registry entry already carries the generated
 * request schema, and that schema knows every field's name, type, whether it
 * is required, and its allowed values — so `create` and `update` expose one
 * flag per field instead of only a raw `--data '{…}'` blob.
 *
 * Every leaf gets one, nested ones too (ADR 071 §2): a field's flag is its
 * path with each segment kebab-cased, joined with `-`, so `oidc.client_id` is
 * `--oidc-client-id`. A list of scalars is a repeatable flag, an open record (a
 * user's `attributes`) a repeatable `key=value` one. What no single flag can
 * hold — an array of objects, a union of several shapes — has no flag and is
 * reached through `--set` or the whole document.
 *
 * Introspection is defensive: an unrecognised schema yields no fields, and
 * the command falls back to `--set` and the raw-body flags alone.
 */

/** How a field is given on the command line. `json` has no flag of its own. */
export type FieldKind =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "enum"
  | "list"
  | "record"
  | "json";

export type BodyField = Readonly<{
  /** Dot path of the field in the document (`oidc.client_id`); the wire name at the top level. */
  name: string;
  /** The same path, segment by segment, as the wire spells it. */
  path: readonly string[];
  /** Flag name as typed (`oidc-client-id`); absent when no flag can carry the field. */
  flag?: string;
  kind: FieldKind;
  /** Whether every body carries it: required in its object, and every object around it too. */
  required: boolean;
  /**
   * The optional object that makes this field required once it is given at
   * all: `["oidc"]` for `oidc.issuer`, which only a connection with an `oidc`
   * block must carry.
   */
  requiredWith?: readonly string[];
  /** Closed value set, for an `enum` field or a list of one. */
  options?: readonly string[];
  /** What a `list` holds. */
  item?: "string" | "number" | "integer" | "enum";
  /** What the schema fills in when the field is left out. */
  default?: { value: unknown };
  /** One-line summary of the schema's description, used as flag help. */
  summary: string;
  /** The field's own schema, which types the text the command line gives it. */
  node: ZodLike;
}>;

/**
 * Flags a write command owns, or every command does; a body field whose flag
 * would be one of these gets none, and stays reachable through `--set`.
 */
const RESERVED = new Set([
  "data",
  "file",
  "set",
  "json",
  "help",
  "version",
  "force",
  "cwd",
  "server",
  "non-interactive",
  "dry-run",
  "verbose",
  "debug",
  "color",
  "no-color",
  "telemetry",
  "no-telemetry",
]);

/**
 * How deep the walk goes. Generated request schemas nest two or three levels;
 * the limit keeps a self-referential schema from spinning, and anything below
 * it is still reachable through `--set`.
 */
const MAX_DEPTH = 6;

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

type Classified = Pick<BodyField, "kind" | "options" | "item">;

/** How a leaf of a given type is given on the command line. */
const classify = (type: ZodLike | undefined): Classified => {
  switch (type?.def?.type) {
    case "string":
      return { kind: "string" };
    case "number":
      return { kind: isInteger(type) ? "integer" : "number" };
    case "boolean":
      return { kind: "boolean" };
    case "enum":
      return { kind: "enum", ...(type.options ? { options: type.options } : {}) };
    case "record":
      return { kind: "record" };
    case "array": {
      const element = classify(unwrap(type.def.element));
      return element.kind === "string" ||
        element.kind === "number" ||
        element.kind === "integer" ||
        element.kind === "enum"
        ? {
            kind: "list",
            item: element.kind,
            ...(element.options ? { options: element.options } : {}),
          }
        : { kind: "json" };
    }
    case "union": {
      // A string that may be `null` (a clearable field) reads as a plain string
      // flag; clearing it is `--set <path>:=null`.
      const members = (type.def.options ?? []).map((member) => unwrap(member));
      const values = members.filter((member) => member?.def?.type !== "null");
      return values.length === 1 && values[0]?.def?.type === "string"
        ? { kind: "string" }
        : { kind: "json" };
    }
    default:
      return { kind: "json" };
  }
};

/** A leaf before its flag is settled, which needs every other leaf's. */
type Leaf = Omit<BodyField, "flag">;

/**
 * The leaves below one object. `chainRequired` says whether every object
 * around this one is required; `optionalAncestor` is the innermost one that is
 * not. A leaf required within the objects below it is required exactly when
 * that object is given: the objects around it are then given too, and the ones
 * between it and the leaf are required.
 */
const leavesOf = (
  object: ZodLike,
  prefix: readonly string[],
  chainRequired: boolean,
  optionalAncestor: readonly string[] | undefined,
): Leaf[] =>
  Object.entries(object.shape ?? {}).flatMap(([key, field]): Leaf[] => {
    const path = [...prefix, key];
    const requiredHere = !isOptionalField(field);
    const required = chainRequired && requiredHere;
    const nested = objectOf(field);
    if (nested?.shape && Object.keys(nested.shape).length > 0 && path.length < MAX_DEPTH) {
      return leavesOf(nested, path, required, requiredHere ? optionalAncestor : path);
    }
    const inner = unwrap(field);
    const fallback = defaultOf(field);
    return [
      {
        name: path.join("."),
        path,
        ...classify(inner),
        required,
        ...(requiredHere && !chainRequired && optionalAncestor
          ? { requiredWith: optionalAncestor }
          : {}),
        ...(fallback ? { default: fallback } : {}),
        summary: summarize(field.description ?? inner?.description),
        node: field,
      },
    ];
  });

/** The flag a leaf would get, before collisions are settled. */
const candidateFlag = (leaf: Leaf): string | undefined =>
  leaf.kind === "json" ? undefined : leaf.path.map(kebab).join("-");

/** The flag names a leaf occupies: its own, and `--no-<flag>` for a boolean. */
const occupied = (leaf: Leaf, flag: string): string[] =>
  leaf.kind === "boolean" ? [flag, `no-${flag}`] : [flag];

/**
 * Give each leaf its flag. Two leaves that would share a name, or a name the
 * command already owns, both go without, so neither silently shadows the
 * other; they stay reachable through `--set`.
 */
const settleFlags = (leaves: readonly Leaf[], reserved: ReadonlySet<string>): BodyField[] => {
  const uses = new Map<string, number>();
  for (const leaf of leaves) {
    const flag = candidateFlag(leaf);
    for (const name of flag ? occupied(leaf, flag) : []) {
      uses.set(name, (uses.get(name) ?? 0) + 1);
    }
  }
  return leaves.map((leaf) => {
    const flag = candidateFlag(leaf);
    const free =
      flag !== undefined &&
      occupied(leaf, flag).every(
        (name) => uses.get(name) === 1 && !RESERVED.has(name) && !reserved.has(name),
      );
    return free ? { ...leaf, flag } : leaf;
  });
};

/** What a write command's body is described from. */
export type DescribeOptions = Readonly<{
  /**
   * Property the document sits under in the request body (`idp`). The fields
   * are then the document's own, which is how every other surface — a file
   * under `.zitadel/`, `get --json` — spells the resource.
   */
  root?: string;
  /** Flags the command declares beyond the factory's own, which a field must not take. */
  reserved?: Iterable<string>;
}>;

/** The schema of the document a write sends: the body, or the part of it under `root`. */
export const documentSchemaOf = (schema: Schema, root?: string): ZodLike | undefined =>
  root === undefined ? (schema as ZodLike) : fieldOf(schema as ZodLike, root);

/**
 * Read the fields of a generated request schema, nested ones included.
 * Returns an empty list for anything that is not an object schema, so the
 * caller degrades to `--set` and `--data` / `--file`.
 */
export const describeBody = (
  schema: Schema,
  options: DescribeOptions = {},
): readonly BodyField[] => {
  const document = objectOf(documentSchemaOf(schema, options.root));
  if (!document) {
    return [];
  }
  return settleFlags(leavesOf(document, [], true, undefined), new Set(options.reserved ?? []));
};

/** A float flag; oclif's own number flag only takes integers. */
const numberFlag = Flags.custom<number>({
  parse: async (input) => {
    const value = Number(input);
    if (input.trim() === "" || !Number.isFinite(value)) {
      throw new Error(`Expected a number but received: ${input}`);
    }
    return value;
  },
});

/**
 * The help group a field is listed under. A top-level field is grouped by
 * whether it is required; a nested one by the object it belongs to, so the
 * `oidc` fields of a connection read as one block.
 */
const helpGroupOf = (field: BodyField): string => {
  if (field.path.length === 1) {
    return field.required ? "REQUIRED FIELD" : "OPTIONAL FIELD";
  }
  return `${(field.path[0] ?? "").replaceAll("_", " ").toUpperCase()} FIELD`;
};

/** The oclif flag for one field. */
const flagFor = (field: BodyField): Interfaces.FlagInput[string] => {
  // oclif orders help groups by their first flag alphabetically, so the
  // required marker also rides in the description rather than relying on the
  // group heading coming first.
  const description = [
    field.required
      ? "(required)"
      : field.requiredWith
        ? `(required with ${field.requiredWith.join(".")}.*)`
        : "",
    field.kind === "record"
      ? `Repeatable ${field.name} entry: key=value for a string, key:=value for JSON.`
      : "",
    field.kind === "list" ? "Repeatable, one value each." : "",
    field.summary,
  ]
    .filter(Boolean)
    .join(" ");
  const common = { description, helpGroup: helpGroupOf(field) };
  const options = field.options ? { options: [...field.options] } : {};
  switch (field.kind) {
    case "boolean":
      return Flags.boolean({ ...common, allowNo: true });
    case "integer":
      return Flags.integer(common);
    case "number":
      return numberFlag(common);
    case "record":
      return Flags.string({ ...common, multiple: true });
    case "list":
      return field.item === "integer"
        ? Flags.integer({ ...common, multiple: true })
        : field.item === "number"
          ? numberFlag({ ...common, multiple: true })
          : Flags.string({ ...common, ...options, multiple: true });
    default:
      return Flags.string({ ...common, ...options });
  }
};

/** oclif flags for the given fields; a field without a flag is left to `--set`. */
export const bodyFieldFlags = (fields: readonly BodyField[]): Interfaces.FlagInput =>
  Object.fromEntries(
    fields.flatMap((field) => (field.flag === undefined ? [] : [[field.flag, flagFor(field)]])),
  );

/**
 * Build the document fragment the field flags describe, nesting each value at
 * its path. Returns `undefined` when no field flag was given, so the caller
 * can tell "no body at all" from "a body made of flags".
 */
export const bodyFromFlags = (fields: readonly BodyField[], flags: Json): Json | undefined => {
  let body: Json | undefined;
  for (const field of fields) {
    const value = field.flag === undefined ? undefined : flags[field.flag];
    if (value === undefined || field.flag === undefined) {
      continue;
    }
    body = setAt(body ?? {}, field.path, field.kind === "record" ? recordOf(field, value) : value);
  }
  return body;
};

/** The object a repeatable record flag's entries make. */
const recordOf = (field: BodyField, value: unknown): Json => {
  const values = unwrap(field.node)?.def?.valueType;
  const entries = (Array.isArray(value) ? value : [value]).map((entry) =>
    parsePair(String(entry), field.flag ?? field.name, values),
  );
  return Object.fromEntries(entries);
};

/**
 * One entry of a repeatable record flag.
 *
 * `key:=value` parses the value as JSON. `key=value` is the value as the
 * record's schema types it (ADR 071 §3): text where its values may be strings
 * or are untyped — a user's `attributes`, so an identifier that looks numeric
 * (a postal code, a phone number) survives — and a number or a boolean where
 * the schema declares nothing else. The split is HTTPie's, and keeping the two
 * explicit means the CLI never has to guess which one was meant.
 */
const parsePair = (
  raw: string,
  flag: string,
  values: ZodLike | undefined,
): readonly [string, unknown] => {
  const json = raw.indexOf(":=");
  const plain = raw.indexOf("=");
  if (json > 0 && json === plain - 1) {
    const key = raw.slice(0, json);
    return [key, jsonValue(raw.slice(json + 2), `--${flag} ${key}`)];
  }
  if (plain <= 0) {
    throw new ZitadelError("E_VALIDATION", `Invalid --${flag} "${raw}"`, {
      hint: `Use --${flag} key=value for a string, or key:=value for JSON (e.g. --${flag} age:=30).`,
    });
  }
  const key = raw.slice(0, plain);
  return [key, typedValue(values, raw.slice(plain + 1), `--${flag} ${key}`)];
};

/**
 * Whether a run made of required flags alone may still be an incomplete body.
 * A nested object can carry rules the required list cannot — a grant names
 * exactly one of `user` and `team` — and a field without a flag cannot be
 * given that way at all. Such a command offers no generated flags-only
 * example; its registry entry may declare one that is complete.
 */
export const flagsAloneMayBeIncomplete = (fields: readonly BodyField[]): boolean =>
  fields.some((field) => field.path.length > 1 || field.flag === undefined);

/** One example invocation using the required fields, for a command's `examples`. */
export const fieldExample = (fields: readonly BodyField[]): string | undefined => {
  const required = fields.filter((field) => field.required);
  if (required.length === 0 || required.some((field) => field.flag === undefined)) {
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
