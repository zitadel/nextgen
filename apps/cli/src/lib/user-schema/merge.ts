import { sortValue } from "../json";
import { fieldPreset } from "./default";

export type AddFieldSpec = {
  name: string;
  schema: Record<string, unknown>;
  required: boolean;
};

export function addFields(
  schema: Record<string, unknown>,
  specs: AddFieldSpec[],
): Record<string, unknown> {
  const next = clone(schema);
  const properties = ensureObject(next, "properties");
  const required = new Set(Array.isArray(next.required) ? next.required.map(String) : []);

  for (const spec of specs) {
    const existing = properties[spec.name];
    properties[spec.name] = {
      ...(isObject(existing) ? existing : {}),
      ...spec.schema,
    };
    if (spec.required) {
      required.add(spec.name);
    }
  }

  next.required = [...required].sort();
  return sortValue(next) as Record<string, unknown>;
}

export function removeFields(
  schema: Record<string, unknown>,
  names: string[],
): Record<string, unknown> {
  const next = clone(schema);
  const properties = ensureObject(next, "properties");
  for (const name of names) {
    delete properties[name];
  }
  next.required = (Array.isArray(next.required) ? next.required.map(String) : [])
    .filter((name) => !names.includes(name))
    .sort();
  return sortValue(next) as Record<string, unknown>;
}

export function parseAddFieldSpec(raw: string): AddFieldSpec {
  const [name, type = "string", attrs = ""] = raw.split(":");
  if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid field name in "${raw}"`);
  }

  const schema: Record<string, unknown> = { ...fieldPreset(name), type };
  let required = false;

  for (const attr of attrs.split(",").filter(Boolean)) {
    const [key = "", value = "true"] = attr.split("=");
    if (key === "required") {
      required = value !== "false";
    } else if (key === "format") {
      schema.format = value;
    } else if (key.startsWith("x-")) {
      schema[key] = parseValue(value);
    } else {
      schema[key] = parseValue(value);
    }
  }

  return { name, schema, required };
}

export function addFieldFromJson(input: Record<string, unknown>): AddFieldSpec {
  if (typeof input.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.name)) {
    throw new Error(`--add-field-json entry missing a valid "name" field`);
  }
  const name = input.name;
  const required = Boolean(input.required);
  const schema: Record<string, unknown> = { ...fieldPreset(name) };
  for (const [key, value] of Object.entries(input)) {
    if (key === "name" || key === "required") continue;
    schema[key] = value;
  }
  if (typeof schema.type !== "string") {
    schema.type = "string";
  }
  return { name, schema, required };
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  if (!isObject(parent[key])) {
    parent[key] = {};
  }
  return parent[key] as Record<string, unknown>;
}

function parseValue(value: string): string | boolean | number {
  if (value === "true") return true;
  if (value === "false") return false;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && value.trim() !== "" ? numberValue : value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
