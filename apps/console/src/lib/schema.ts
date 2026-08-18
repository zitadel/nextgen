import { field } from "./record";

/**
 * A user schema as the console reads it.
 *
 * `GET /schemas/{id}` returns a JSON Schema document whose shape is
 * customer-authored (`additionalProperties: true` all the way down), so the
 * console treats it as an open record and reads only the keys it understands —
 * the same defensive posture `lib/user.ts` takes for users themselves.
 */
export type UserSchema = Record<string, unknown>;

/** One rendered form control, derived from a single schema property. */
export interface SchemaField {
  /** Property key — also the attribute name sent in the `POST /users` body. */
  key: string;
  label: string;
  required: boolean;
  /** `<input type>` chosen from the property's `format` / `x-sensitive`. */
  inputType: "text" | "email" | "password" | "number" | "url" | "tel" | "date";
  placeholder?: string;
}

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
 * `GET /schemas/{id}` serialises `properties` from a Go map, so the response's key
 * order is randomised — identical requests return different orderings, which makes
 * the form shuffle between openings. Sorting by key is the minimum needed to stop
 * that: it is stable and it claims nothing about how the fields should read (it
 * does put "Family name" above "Given name").
 *
 * The authored order belongs to the schema document and should reach the console
 * through the API. When `properties` preserves it, delete this sort and render the
 * response order as-is — do not grow this into a curated field sequence.
 *
 * Nested object properties are skipped — they need a grouped control this screen
 * does not define, and flattening one to a text input would write the wrong shape.
 */
export function schemaFields(schema: UserSchema): SchemaField[] {
  const required = new Set(readRequiredOrder(schema));
  return Object.entries(readProperties(schema))
    .filter(([, property]) => field(property, "type") !== "object")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, property]) => ({
      key,
      label: propertyLabel(key, property),
      required: required.has(key),
      inputType: propertyInputType(property),
      placeholder: propertyPlaceholder(property),
    }));
}

/**
 * The columns the users table shows, unioned across every schema the loaded
 * users actually reference.
 *
 * The design (`277:288291`) has no fixed column set: its `Filled` variant lists
 * Given name / Family name / Company name / Email while `Minimal` lists only
 * Email, because the user model is `additionalProperties: true` keyed on
 * `schema`. The design decisions log (D4) settles what to show — every
 * available field rather than a curated default — so this unions rather than
 * intersects: a project with both a `business` and a `minimal` schema shows the
 * business columns, and minimal users render blank in them.
 *
 * Order follows {@link schemaFields} within a schema, and first-seen order
 * across them, so adding a schema appends columns instead of reshuffling.
 */
export function schemaColumns(schemas: UserSchema[]): SchemaField[] {
  const columns = new Map<string, SchemaField>();
  for (const schema of schemas) {
    for (const entry of schemaFields(schema)) {
      if (!columns.has(entry.key)) columns.set(entry.key, entry);
    }
  }
  return [...columns.values()];
}

/**
 * Every property a schema declares, including the nested objects
 * {@link schemaFields} drops.
 *
 * `schemaFields` exists to build a *form*, so it filters out `type: object` —
 * there is no single control that writes one. The schema screens read the
 * document instead of writing to it, and the design's field table renders an
 * object as a row you drill into, so this keeps them.
 *
 * Sorted by key for the same reason `schemaFields` is: `GET /schemas/{id}`
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

/** A sign-in method as the schema's `x-auth-methods` annotation declares it. */
export interface SchemaAuthMethod {
  /** Annotation key — `password`, `passkey`, `magic_link`, `sso`, `otp`. */
  key: string;
  label: string;
  enabled: boolean;
}

/**
 * The sign-in methods a schema declares.
 *
 * `x-auth-methods` says which methods a user type supports; the order they are
 * offered in is the flow's, from the order of a step's actions. So the sort
 * here claims nothing — it exists for the same reason {@link schemaFields}
 * sorts: `GET /schemas/{id}` serialises from a Go map, so the response's key
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
      return {
        key,
        label: AUTH_METHOD_LABELS[key] ?? key,
        enabled: entry.enabled === true,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
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

function readProperties(schema: UserSchema): Record<string, Record<string, unknown>> {
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
  return names.map((name) => name.charAt(0).toUpperCase() + name.slice(1)).join(" | ");
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
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

/**
 * `x-sensitive` masks the value — it is the schema's own marker for data that
 * must not be shown in the clear (ADR 020 keeps credentials out of the schema,
 * but a customer schema may still flag an attribute). Otherwise the JSON Schema
 * `format` picks the input type so browsers contribute their native keyboards
 * and validation.
 */
function propertyInputType(property: Record<string, unknown>): SchemaField["inputType"] {
  if (property["x-sensitive"] === true) return "password";
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
  const type = field(property, "type");
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
