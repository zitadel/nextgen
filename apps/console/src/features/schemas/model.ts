import { field, isRecord } from "@/lib/record";
import { titleCase } from "@/lib/text";

/**
 * A user schema as the console reads it.
 *
 * `GET /schemas/{schema_id}` returns a JSON Schema document whose shape is
 * customer-authored (`additionalProperties: true` all the way down), so the
 * console treats it as an open record and reads only the keys it understands —
 * the same defensive posture `features/users/model.ts` takes for users themselves.
 */
export type UserSchema = Record<string, unknown>;

/** A user schema at its latest revision, with that revision's created date. */
export interface SchemaEntry {
  id: string;
  schema: UserSchema;
  createdAt: string;
}

/** One revision of a user schema: its own id, and when it was minted. */
export interface SchemaRevision {
  id: string;
  createdAt: string;
  /** Whether any user of the project is on it; only when asked for, and answered. */
  inUse?: boolean;
}

/** What every form control knows about the property it stands for. */
interface FieldBase {
  /** Property key: the attribute name in the `POST /users` body. */
  key: string;
  /** Its dot-joined attribute path, as the API and the CLI name it (`contact.email`). */
  attributePath: string;
  label: string;
  required: boolean;
  /** The property the schema's `x-identifier` names. */
  identifier?: boolean;
  /** The schema's own `description`, for help text. */
  description?: string;
}

/** The rules a schema puts on one value, as far as a form explains or checks them. */
export interface FieldRules {
  format?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
}

/** A property one control writes: a text or number input, a switch or a select. */
export interface ValueField extends FieldBase {
  kind: "value";
  /**
   * `<input type>` chosen from the property's JSON Schema `format`, or
   * `boolean`, which no `<input type>` names: each form picks its own control.
   */
  inputType: "text" | "email" | "number" | "url" | "tel" | "date" | "boolean";
  placeholder?: string;
  /** `integer` rather than `number`: a stricter reading of the same input. */
  integer: boolean;
  /** Whether `null` is a value the schema accepts (`["string", "null"]`). */
  nullable: boolean;
  /** The allowed values, in their JSON types, for a select. */
  options?: unknown[];
  default?: unknown;
  /** Whether surrounding spaces are noise here, rather than part of the value. */
  trim: boolean;
  rules: FieldRules;
}

/** An object with declared properties: a group of its own controls. */
export interface ObjectField extends FieldBase {
  kind: "object";
  fields: SchemaField[];
  nullable: boolean;
  default?: unknown;
}

/** An array whose items all share a shape: one control per item. */
export interface ArrayField extends FieldBase {
  kind: "array";
  /** One item, for a button that adds one: its `title`, since the array's own is a plural. */
  itemNoun: string;
  item: SchemaField;
  nullable: boolean;
  minItems?: number;
  maxItems?: number;
  uniqueItems: boolean;
  default?: unknown;
}

/**
 * A property no control can write without guessing its shape (`oneOf`, a mixed
 * union, a free-form object, a tuple): shown, never written.
 */
export interface OpaqueField extends FieldBase {
  kind: "opaque";
}

/** One rendered form control, derived from a single schema property. */
export type SchemaField = ValueField | ObjectField | ArrayField | OpaqueField;

/**
 * The `<input>` attributes a field's type decides. A number is typed as text:
 * a number input reports text it cannot parse as empty, which a form would
 * read as emptied, and iOS's decimal keypad has no minus key. A boolean is
 * typed as text where a form has no switch for it.
 */
export function inputAttributes(entry: ValueField): { type: string } {
  const text = entry.inputType === "number" || entry.inputType === "boolean";
  return { type: text ? "text" : entry.inputType };
}

/**
 * The JSON value a form control's text stands for. An input always yields a
 * string, but JSON Schema validates a `number`/`integer` property against a
 * JSON number, and `"42"` would be rejected. A value that will not parse is
 * sent through untouched so the server explains why, rather than becoming
 * `NaN`, which `JSON.stringify` would silently turn into `null`. So is text
 * `Number` would read differently than typed: hex, binary or octal (`0x10` is
 * 16), and a whole number past 2^53, which it rounds. A boolean is `"true"` or
 * `"false"`, as a switch writes it; other text is sent as typed.
 */
export function attributeValue(entry: ValueField, value: string): unknown {
  if (entry.inputType === "boolean" && (value === "true" || value === "false")) {
    return value === "true";
  }
  if (entry.inputType !== "number" || !DECIMAL.test(value)) return value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return Number.isInteger(numeric) && !Number.isSafeInteger(numeric) ? value : numeric;
}

export const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * Human-readable schema name for the picker.
 *
 * Schemas carry no dedicated name field: `title` is the authored document
 * title (`DefaultHumanUserSchema` in the shipped preset) and `objectType` is
 * the customer-chosen kind (`human-user`). Prefer the title, fall back to the
 * object type, and finally to the id so the row is never blank.
 */
export function schemaDisplayName(schema: UserSchema, id: string): string {
  return field(schema, "title") ?? field(schema, "objectType") ?? id;
}

/**
 * The property names a schema defines, joined for the picker's second line
 * (`email · givenName · familyName`). Deliberately the raw keys rather than
 * humanised labels: the point of the line is to show which attributes the
 * schema will ask for, and the keys are what the API actually stores.
 *
 * Ordered through {@link schemaFields} so the summary lists the properties in
 * the same sequence the form renders them — and so it does not inherit the
 * response's randomised key order.
 */
export function schemaFieldSummary(schema: UserSchema): string {
  return schemaFields(schema)
    .map((entry) => entry.key)
    .join(" · ");
}

/**
 * Build the form controls for a schema.
 *
 * **Field order is not decided here, and deliberately encodes no intent.**
 * `GET /schemas/{schema_id}` serialises `properties` from a Go map, so the response's key
 * order is randomised — identical requests return different orderings, which makes
 * the form shuffle between openings. Sorting by key is the minimum needed to stop
 * that: it is stable and it claims nothing about how the fields should read (it
 * does put "Family name" above "Given name").
 *
 * The authored order belongs to the schema document and should reach the console
 * through the API. When `properties` preserves it, delete this sort and render the
 * response order as-is — do not grow this into a curated field sequence.
 *
 * A nested object is a field holding its properties' fields, and an array one
 * holding its item's, so every form renders the same tree.
 */
export function schemaFields(schema: UserSchema): SchemaField[] {
  return objectFields(schema, [], field(schema, "x-identifier"));
}

function objectFields(node: UserSchema, path: string[], identifier?: string): SchemaField[] {
  const required = new Set(readRequiredOrder(node));
  const properties = readProperties(node);
  // A required name with no property still has to be answered, and nothing here
  // can answer it, so it is a field the form can say that about.
  const undeclared = [...required].filter((key) => !Object.hasOwn(properties, key));
  return [...Object.entries(properties), ...undeclared.map((key) => [key, { not: {} }] as const)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, property]) =>
      propertyField(key, property, required.has(key), [...path, key], identifier),
    );
}

/** How many properties a field stands for: an object counts everything inside it. */
export function fieldCount(field: SchemaField): number {
  if (field.kind !== "object") return 1;
  return field.fields.reduce((count, child) => count + fieldCount(child), 0);
}

/** What a table column needs from a field. */
export type SchemaColumn = Pick<SchemaField, "key" | "label" | "required">;

/**
 * The top-level properties that take one row or column of a flat list, so never
 * an object, in {@link schemaFields}' order: the users table's columns and the
 * Profile's rows (D16, D23).
 */
export function schemaFlatFields(schema: UserSchema): SchemaField[] {
  const properties = readProperties(schema);
  return schemaFields(schema).filter((entry) => {
    const property = Object.hasOwn(properties, entry.key) ? properties[entry.key] : undefined;
    return property && entry.kind !== "object" && readType(property).name !== "object";
  });
}

/**
 * The Profile's rows, one text input each (D16). A property the forms have no
 * control for still reads as its own `type`, so a number stays a number when saved.
 */
export function schemaFlatRows(schema: UserSchema): ValueField[] {
  const properties = readProperties(schema);
  return schemaFlatFields(schema).map((entry) => {
    if (entry.kind === "value") return entry;
    const property = properties[entry.key] ?? {};
    const { name } = readType(property);
    const placeholder = propertyPlaceholder(property);
    return {
      kind: "value",
      key: entry.key,
      attributePath: entry.attributePath,
      label: entry.label,
      required: entry.required,
      inputType: propertyInputType(property, name),
      ...(placeholder ? { placeholder } : {}),
      integer: name === "integer",
      nullable: false,
      trim: true,
      rules: {},
    };
  });
}

/**
 * Keywords that say a property's shape depends on more than its `type`, so a
 * control picked from the `type` alone could write something it refuses.
 */
const COMPOSED = ["$ref", "$dynamicRef", "allOf", "anyOf", "oneOf", "not", "if"];

function propertyField(
  key: string,
  property: Record<string, unknown>,
  required: boolean,
  path: string[],
  identifier?: string,
): SchemaField {
  const description = field(property, "description");
  const attributePath = path.join(".");
  const base = {
    key,
    attributePath,
    label: propertyLabel(key, property),
    required,
    ...(attributePath === identifier ? { identifier: true } : {}),
    ...(description ? { description } : {}),
  };
  const opaque: OpaqueField = { ...base, kind: "opaque" };
  const declaredDefault = "default" in property ? { default: property.default } : {};

  if (COMPOSED.some((keyword) => keyword in property)) return opaque;
  const { name, nullable, union } = readType(property);
  if (union) return opaque;

  if (name === "object" || (name === undefined && isRecord(property.properties))) {
    const fields = objectFields(property, path, identifier);
    if (fields.length === 0) return opaque;
    return { ...base, ...declaredDefault, kind: "object", fields, nullable };
  }
  if (name === "array") {
    if (!isRecord(property.items) || "prefixItems" in property) return opaque;
    const item = propertyField(key, property.items, true, path);
    if (item.kind === "opaque") return opaque;
    return {
      ...base,
      ...declaredDefault,
      kind: "array",
      item,
      itemNoun: field(property.items, "title") ?? "item",
      nullable,
      ...optionalNumber("minItems", property.minItems),
      ...optionalNumber("maxItems", property.maxItems),
      uniqueItems: property.uniqueItems === true,
    };
  }

  const allowed = "const" in property ? [property.const] : property.enum;
  const listed = Array.isArray(allowed);
  const members: unknown[] = listed ? allowed : [];
  if (members.some((member) => member !== null && typeof member === "object")) return opaque;
  const options = members.filter((member) => member !== null);
  if (listed && options.length === 0) return opaque;

  const inputType = propertyInputType(property, name);
  const placeholder = propertyPlaceholder(property);
  return {
    ...base,
    ...declaredDefault,
    kind: "value",
    inputType,
    ...(placeholder ? { placeholder } : {}),
    integer: name === "integer",
    // `null` has to pass both keywords: `type` and `enum` each refuse it on their own.
    nullable: listed ? members.includes(null) && (name === undefined || nullable) : nullable,
    ...(listed ? { options } : {}),
    trim: inputType !== "text" || "format" in property || attributePath === identifier,
    rules: propertyRules(property),
  };
}

/**
 * A property's JSON Schema `type`, read through a union with `null`:
 * `["integer", "null"]` is a nullable integer. A union of two real types has no
 * one control (`union`), and neither has `null` alone.
 */
function readType(property: Record<string, unknown>): {
  name?: string;
  nullable: boolean;
  union: boolean;
} {
  const type = property.type;
  if (!Array.isArray(type)) {
    if (type === "null") return { nullable: true, union: true };
    return { ...(typeof type === "string" ? { name: type } : {}), nullable: false, union: false };
  }
  const names = type.filter((entry): entry is string => typeof entry === "string");
  const real = names.filter((entry) => entry !== "null");
  const [name] = real;
  if (real.length !== 1 || name === undefined) return { nullable: false, union: names.length > 0 };
  return { name, nullable: names.includes("null"), union: false };
}

const NUMERIC_RULES = [
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
] as const;

function propertyRules(property: Record<string, unknown>): FieldRules {
  const format = field(property, "format");
  const pattern = field(property, "pattern");
  return {
    ...(format ? { format } : {}),
    ...(pattern ? { pattern } : {}),
    ...Object.assign({}, ...NUMERIC_RULES.map((name) => optionalNumber(name, property[name]))),
  };
}

function optionalNumber<K extends string>(name: K, value: unknown): { [P in K]?: number } {
  return (typeof value === "number" ? { [name]: value } : {}) as { [P in K]?: number };
}

/**
 * Every property a schema declares, as the schema screens read it.
 *
 * `schemaFields` exists to build a *form*, so it says what writes each property.
 * The schema screens read the document instead of writing to it, and the design's
 * field table renders an object as a row you drill into, so this lists them flat.
 *
 * Sorted by key for the same reason `schemaFields` is: `GET /schemas/{schema_id}`
 * serialises `properties` from a Go map, so the response order is randomised
 * and an unsorted table reshuffles between loads.
 */
export function schemaProperties(node: UserSchema): SchemaProperty[] {
  const required = new Set(readRequiredOrder(node));
  return Object.entries(readProperties(node))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, property]) => ({
      key,
      type: propertyTypeLabel(property),
      required: required.has(key),
      isObject: isObjectProperty(property),
    }));
}

/** One row of the detail screen's `FIELD | TYPE | REQ.` table. */
export interface SchemaProperty {
  key: string;
  /** Capitalised JSON Schema `type` (`String`, `Object`, …), or `—`. */
  type: string;
  required: boolean;
  /** Whether the row drills into a nested property table. */
  isObject: boolean;
}

/**
 * Walk into a nested object property, e.g. `["address", "geo"]`.
 *
 * Returns `undefined` when any segment is missing or is not an object, so a
 * stale drill-in path (a bookmarked URL, a schema that changed underneath)
 * falls back to the root rather than rendering an empty table.
 */
export function resolveSchemaPath(schema: UserSchema, path: string[]): UserSchema | undefined {
  let node: UserSchema = schema;
  for (const segment of path) {
    const next = readProperties(node)[segment];
    if (!next || !isObjectProperty(next)) return undefined;
    node = next;
  }
  return node;
}

/**
 * One property a schema node declares, or `undefined` where it declares none
 * by that key (an attribute the schema does not describe).
 */
export function declaredProperty(
  node: UserSchema | undefined,
  key: string,
): Record<string, unknown> | undefined {
  if (!node) return undefined;
  const properties = readProperties(node);
  return Object.hasOwn(properties, key) ? properties[key] : undefined;
}

/**
 * A property's label as the forms and columns show it: its `title`, else the
 * key humanised. A key the schema does not declare keeps its own spelling.
 */
export function schemaPropertyLabel(key: string, property?: Record<string, unknown>): string {
  return property ? propertyLabel(key, property) : key;
}

/** A sign-in method as the schema's `x-auth-methods` annotation declares it. */
export interface SchemaAuthMethod {
  /** Annotation key — `password`, `passkey`, `magic_link`, `sso`, `otp`. */
  key: string;
  label: string;
  enabled: boolean;
  /**
   * The connection slugs an enabled `sso` lists in `providers`, verbatim and in
   * the document's order. Empty for every other method, and for `sso` while it
   * is disabled: the meta-schema forbids `providers` then, so a stray list on a
   * disabled method describes nothing a user can sign in with.
   */
  providers: string[];
}

/**
 * The sign-in methods a schema declares.
 *
 * `x-auth-methods` says which methods a user type supports; the order they are
 * offered in is the flow's, from the order of a step's actions. So the sort
 * here claims nothing — it exists for the same reason {@link schemaFields}
 * sorts: `GET /schemas/{schema_id}` serialises from a Go map, so the response's key
 * order is randomised and an unsorted list reshuffles between loads.
 *
 * Every declared method is returned, not just the two the backend supports
 * today (D10). A schema that turns on `otp` should show `otp`, not silently
 * drop it.
 */
export function schemaAuthMethods(schema: UserSchema): SchemaAuthMethod[] {
  const methods = schema["x-auth-methods"];
  if (!methods || typeof methods !== "object") return [];
  return Object.entries(methods as Record<string, unknown>)
    .map(([key, value]) => {
      const entry = (value ?? {}) as Record<string, unknown>;
      const enabled = entry.enabled === true;
      return {
        key,
        label: AUTH_METHOD_LABELS[key] ?? key,
        enabled,
        providers: key === "sso" && enabled ? readProviders(entry.providers) : [],
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * The connection slugs a schema's latest revision makes available to its users
 * (`x-auth-methods.sso.providers`), or none when SSO is off or undeclared.
 */
export function schemaSsoProviders(schema: UserSchema): string[] {
  return schemaAuthMethods(schema).find((method) => method.key === "sso")?.providers ?? [];
}

/**
 * `"Passkey + SSO (google, github)"` — the enabled methods as one line, for the
 * schemas list. The slugs are shown raw: resolving them to connection names
 * needs `idp.read`, which the schema screens do not assume.
 */
export function schemaSignInSummary(schema: UserSchema): string {
  return schemaAuthMethods(schema)
    .filter((method) => method.enabled)
    .map((method) =>
      method.providers.length > 0
        ? `${method.label} (${method.providers.join(", ")})`
        : method.label,
    )
    .join(" + ");
}

function readProviders(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((slug): slug is string => typeof slug === "string")
    : [];
}

/**
 * Human-readable names for the methods the meta-schema enumerates. A key
 * outside this set renders verbatim rather than being hidden — the annotation
 * is customer-authored and `additionalProperties` may grow.
 */
const AUTH_METHOD_LABELS: Record<string, string> = {
  password: "Password",
  passkey: "Passkey",
  magic_link: "Magic link",
  sso: "SSO",
  otp: "One-time code",
};

/**
 * The keyword that designates a leaf property (ADR 058): `x-identifier`, one
 * of the `x-display` parts, or nothing. Both name a leaf by its dot-joined
 * attribute path, so a nested one is found by its full path.
 */
export function schemaDesignation(
  schema: UserSchema,
  path: string[],
): "x-identifier" | "x-display" | undefined {
  const joined = path.join(".");
  if (field(schema, "x-identifier") === joined) return "x-identifier";
  const display = schema["x-display"];
  if (Array.isArray(display) && display.includes(joined)) return "x-display";
  return undefined;
}

export function readProperties(schema: UserSchema): Record<string, Record<string, unknown>> {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return {};
  return properties as Record<string, Record<string, unknown>>;
}

function readRequiredOrder(schema: UserSchema): string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string")
    : [];
}

/**
 * A property is drillable when it is an object *and* declares properties.
 * `type: object` with no `properties` is an open bag — there is nothing to
 * drill into, so it renders as a leaf row instead of a dead-end chevron.
 */
function isObjectProperty(property: Record<string, unknown>): boolean {
  if (field(property, "type") !== "object") return false;
  const properties = property.properties;
  return !!properties && typeof properties === "object" && Object.keys(properties).length > 0;
}

/** `"string"` → `String`. JSON Schema also allows a type union; join those. */
function propertyTypeLabel(property: Record<string, unknown>): string {
  const type = property.type;
  const names = Array.isArray(type)
    ? type.filter((entry): entry is string => typeof entry === "string")
    : typeof type === "string"
      ? [type]
      : [];
  if (names.length === 0) return "—";
  return names.map(titleCase).join(" | ");
}

/**
 * An authored `title` wins; otherwise the key is humanised
 * (`companyName` → `Company name`). JSON Schema has no required label, so a
 * schema that omits `title` still gets a readable field name instead of a
 * camelCase key leaking into the UI.
 */
function propertyLabel(key: string, property: Record<string, unknown>): string {
  const title = field(property, "title");
  if (title) return title;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim()
    .split(/\s+/);
  const [first, ...rest] = words;
  if (!first) return key;
  return [titleCase(first), ...rest].join(" ");
}

/**
 * The JSON Schema `format` picks the input type, so browsers contribute their
 * native keyboards and pickers. Not their validation: the forms are `noValidate`,
 * because `type="url"` would refuse what the `url` annotation lets through.
 *
 * Nothing here masks a value. ADR 020 keeps credentials out of the user schema,
 * so no attribute is a secret, and the users table renders every attribute in
 * the clear regardless — masking the form alone was a promise the rest of the
 * console did not keep. `writeOnly` is the annotation for a value the read API
 * withholds; this can key off it once the server enforces it.
 */
function propertyInputType(
  property: Record<string, unknown>,
  type: string | undefined,
): ValueField["inputType"] {
  switch (field(property, "format")) {
    case "email":
      return "email";
    case "uri":
    case "url":
      return "url";
    case "date":
      return "date";
    case "phone":
    case "tel":
      return "tel";
    default:
      break;
  }
  if (type === "boolean") return "boolean";
  return type === "number" || type === "integer" ? "number" : "text";
}

/**
 * Placeholders come from the schema's own `examples` / `example` keyword. The
 * design shows hints like `e.g. Jane`, but those are not derivable from a
 * schema that does not author them — inventing one per property name would put
 * words in the customer's mouth, so a schema without examples renders no
 * placeholder.
 */
function propertyPlaceholder(property: Record<string, unknown>): string | undefined {
  const examples = property.examples;
  if (Array.isArray(examples)) {
    const first = examples.find((value) => typeof value === "string");
    if (typeof first === "string") return first;
  }
  return field(property, "example");
}
