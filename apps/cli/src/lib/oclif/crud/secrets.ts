import { ZitadelError } from "../../errors";
import { isObject } from "../../json";
import { fieldOf, objectOf, unwrap, type ZodLike } from "./zod";

/**
 * Names whose value is a credential. Anything on the command line — a flag
 * value, and equally `--data "$(cat body.json)"`, which the shell expands
 * before the CLI runs — is visible to other processes, kept in shell history,
 * and captured by CI logs. Only a named file or stdin keeps it out of argv,
 * so those are the routes the errors point at.
 */
const SECRET_WORDS = new Set([
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "credential",
  "credentials",
]);

/** Secret names that only read as such once their words are joined. */
const SECRET_COMPOUNDS = ["apikey", "privatekey", "accesskey", "secretkey"];

/**
 * Last words that make a credential-sounding name the name of an address:
 * `token_endpoint` is where a token is fetched, not a token, and a URL is no
 * credential.
 */
const ADDRESS_WORDS = new Set(["endpoint", "url", "uri"]);

/**
 * Whether a property name reads as a credential. Splits snake_case,
 * kebab-case and camelCase alike, so `client_secret`, `api-key` and
 * `userToken` all match while `passwordless` — one word that merely starts the
 * same way — does not, and neither does `token_endpoint`, which names an
 * address.
 */
export const isSecretKey = (key: string): boolean => {
  const words = key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (ADDRESS_WORDS.has(words.at(-1) ?? "")) {
    return false;
  }
  return (
    words.some((word) => SECRET_WORDS.has(word)) ||
    SECRET_COMPOUNDS.some((compound) => words.join("").includes(compound))
  );
};

/** Where a credential can go without passing through the command line. */
export const SECRET_ROUTES = "--file <path>, or --file - to read the body from stdin";

/**
 * How the platform spells a reference to a value it holds elsewhere — Zitadel's
 * `${{ NAME }}` variables (ADR 062). A reference names a credential without
 * revealing it, so it may stand on a command line: it is the only form some
 * fields accept (a connection's `client_secret`).
 */
export type References = Readonly<{
  /** Whether a whole value is a reference. */
  matches: (value: string) => boolean;
  /** A reference as an error shows one. */
  example: string;
}>;

/** What the guard and the redaction know about a value beyond its keys. */
export type CredentialContext = Readonly<{
  /** The schema the value follows, which says where a value cannot be a credential. */
  schema?: ZodLike | undefined;
  references?: References | undefined;
}>;

/** A credential found in a value: the key that names it, and where it sits. */
export type Credential = Readonly<{ key: string; path: string }>;

/** Refuse a credential that reached the command line, naming a route that does not. */
export const refuseSecret = (
  key: string,
  source: string,
  context: Pick<CredentialContext, "references"> & { path?: string } = {},
): never => {
  // A reference is the fix only where the field takes one (a connection's
  // client secret), so the hint offers it as that and not as a way around the
  // refusal for any value.
  const reference = context.references
    ? ` A field that takes a reference to a variable can name it instead, as ${context.references.example}.`
    : "";
  throw new ZitadelError(
    "E_VALIDATION",
    `Refusing to read "${key}" from ${source}: the command line is visible to other processes and is kept in shell history`,
    {
      hint: `Pass the body with ${SECRET_ROUTES}.${reference}`,
      details: { field: key, ...(context.path ? { path: context.path } : {}) },
    },
  );
};

/** Whether a schema accepts any text at all, so a string under it may be anything. */
const freeText = (schema: ZodLike | undefined): boolean =>
  ["string", "any", "unknown", undefined].includes(unwrap(schema)?.def?.type);

/**
 * Whether the schema types `value` as something no credential can be: one of
 * an enum's values, a number where it declares a number, a literal. A secret
 * is free-form text, and a field that only takes `client_secret_basic` or
 * `client_secret_post` holds neither.
 */
const fixedByTheSchema = (schema: ZodLike | undefined, value: unknown): boolean => {
  const type = unwrap(schema);
  switch (type?.def?.type) {
    case "enum":
      return typeof value === "string" && (type.options ?? []).includes(value);
    case "number":
      return typeof value === "number";
    case "literal":
      return (type.def?.values ?? []).includes(value);
    case "union": {
      const members = type.def?.options ?? [];
      if (typeof value === "string" && members.some(freeText)) {
        return false;
      }
      return members.some((member) => fixedByTheSchema(member, value));
    }
    default:
      return false;
  }
};

/** The schema of one key below `schema`: a field of an object, or a record's value. */
const childOf = (schema: ZodLike | undefined, key: string): ZodLike | undefined => {
  if (objectOf(schema)) {
    return fieldOf(schema, key);
  }
  const type = unwrap(schema);
  return type?.def?.type === "record" ? type.def.valueType : undefined;
};

/**
 * Whether one leaf is a credential: it sits under a credential-named key (its
 * own or an ancestor's) and is free-form. A boolean or `null` never is, and
 * neither is a reference or a value the schema fixes (ADR 071 §7).
 */
const isCredentialLeaf = (
  value: unknown,
  schema: ZodLike | undefined,
  context: CredentialContext,
): boolean => {
  if (typeof value === "boolean" || value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string" && context.references?.matches(value)) {
    return false;
  }
  return !fixedByTheSchema(schema, value);
};

/** A leaf under a credential-named key, with the key and the schema it sits under. */
type GuardedLeaf = Readonly<{
  leaf: unknown;
  key: string;
  path: readonly string[];
  schema: ZodLike | undefined;
}>;

/** Every leaf of a value that sits under a credential-named key, its own or an ancestor's. */
function* guardedLeaves(
  value: unknown,
  schema: ZodLike | undefined,
  under: string | undefined,
  path: readonly string[],
): Generator<GuardedLeaf> {
  if (Array.isArray(value)) {
    const element = unwrap(schema)?.def?.element;
    for (const [index, entry] of value.entries()) {
      yield* guardedLeaves(entry, element, under, [...path, String(index)]);
    }
    return;
  }
  if (isObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      yield* guardedLeaves(nested, childOf(schema, key), isSecretKey(key) ? key : under, [
        ...path,
        key,
      ]);
    }
    return;
  }
  if (under !== undefined) {
    yield { leaf: value, key: under, path, schema };
  }
}

/** The first credential anywhere in a value, if there is one. */
export const findCredential = (
  value: unknown,
  context: CredentialContext = {},
): Credential | undefined => {
  for (const { leaf, key, path, schema } of guardedLeaves(value, context.schema, undefined, [])) {
    if (isCredentialLeaf(leaf, schema, context)) {
      return { key, path: path.join(".") };
    }
  }
  return undefined;
};

/**
 * A value with every credential masked. A body may legitimately carry a
 * secret when it arrives by `--file` or stdin, but `--dry-run` prints what
 * would be sent — to a terminal, and to whatever captures CI logs — so the
 * value must not travel with it. Everything else is shown as it would be
 * sent, references included, so the preview can be checked and reused.
 */
export const redactCredentials = (
  value: unknown,
  context: CredentialContext = {},
  schema: ZodLike | undefined = context.schema,
  under?: string,
): unknown => {
  if (Array.isArray(value)) {
    const element = unwrap(schema)?.def?.element;
    return value.map((entry) => redactCredentials(entry, context, element, under));
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        redactCredentials(nested, context, childOf(schema, key), isSecretKey(key) ? key : under),
      ]),
    );
  }
  return under !== undefined && isCredentialLeaf(value, schema, context) ? "«redacted»" : value;
};
