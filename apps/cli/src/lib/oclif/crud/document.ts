import { ZitadelError } from "../../errors";
import { isObject } from "../../json";
import type { Json } from "./types";
import { isInteger, unwrap, type ZodLike } from "./zod";

/**
 * The document a write assembles before it sends anything (ADR 071 §1), and
 * the few operations every source of it needs: reading a path, assigning one,
 * laying one source over another, and turning the text a command line carries
 * into the value the schema declares.
 */

/** The value at a path, or `undefined` when a segment on the way is missing. */
export const valueAt = (document: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>(
    (current, segment) =>
      isObject(current) && Object.hasOwn(current, segment) ? current[segment] : undefined,
    document,
  );

/**
 * A copy of `document` holding `value` at `path`. Objects missing on the way
 * are created, and a value in the way (a string, `null`) is replaced: the
 * assignment is the more specific instruction.
 */
export const setAt = (document: Json, path: readonly string[], value: unknown): Json => {
  const [head, ...rest] = path;
  if (head === undefined) {
    return document;
  }
  if (rest.length === 0) {
    return { ...document, [head]: value };
  }
  const child = Object.hasOwn(document, head) ? document[head] : undefined;
  return { ...document, [head]: setAt(isObject(child) ? child : {}, rest, value) };
};

/**
 * `overlay` laid over `base`: objects merge key by key at every depth, and any
 * other value — an array, a scalar, `null` — replaces what was there. That is
 * how one JSON Merge Patch composes with another (RFC 7396), so a flag over
 * `--file` changes the one key it names instead of the object around it, and
 * on an update a `null` still reaches the server, which removes the key.
 */
export const mergeDocuments = (base: unknown, overlay: unknown): unknown => {
  if (!isObject(base) || !isObject(overlay)) {
    return overlay;
  }
  const keys = [...new Set([...Object.keys(base), ...Object.keys(overlay)])];
  return Object.fromEntries(
    keys.map((key) => [
      key,
      !Object.hasOwn(overlay, key)
        ? base[key]
        : Object.hasOwn(base, key)
          ? mergeDocuments(base[key], overlay[key])
          : overlay[key],
    ]),
  );
};

/** Whether a schema accepts the text itself, so no reading of it is needed. */
const takesText = (schema: ZodLike | undefined): boolean =>
  ["string", "enum", "any", "unknown", undefined].includes(unwrap(schema)?.def?.type);

/**
 * A refusal for text that does not fit the schema. `label` is how the caller
 * spelled the value's place (`--set oidc.pkce_enabled`, `--attributes age`),
 * so the error can offer the JSON form of the same entry.
 */
const misfit = (label: string, text: string, expected: string): ZitadelError =>
  new ZitadelError("E_VALIDATION", `${label} expects ${expected}, got "${text}"`, {
    hint: `Give ${expected}, or a JSON value with ${label}:=<json>.`,
  });

/** The scalar `text` stands for under one schema, or the error saying why it does not fit. */
const scalarFrom = (schema: ZodLike | undefined, text: string, label: string): unknown => {
  const type = unwrap(schema);
  switch (type?.def?.type) {
    case "number": {
      const integer = isInteger(type);
      const value = Number(text);
      return text.trim() !== "" && Number.isFinite(value) && (!integer || Number.isInteger(value))
        ? value
        : misfit(label, text, integer ? "an integer" : "a number");
    }
    case "boolean":
      return text === "true"
        ? true
        : text === "false"
          ? false
          : misfit(label, text, "true or false");
    case "null":
      return text === "null" ? null : misfit(label, text, "null");
    case "union": {
      const members = type.def?.options ?? [];
      if (members.some(takesText)) {
        return text;
      }
      const readings = members.map((member) => scalarFrom(member, text, label));
      return readings.find((reading) => !(reading instanceof ZitadelError)) ?? readings[0];
    }
    default:
      return text;
  }
};

/**
 * The value `text` stands for, at a field the schema declares as `schema`.
 *
 * ADR 064 §6 made `key=value` always a string, because the CLI could not know
 * a field's type, and guessing turns a postal code into a number. Where the
 * schema declares the type, nothing is guessed: a field typed as a number or a
 * boolean reads the text as one (`pkce_enabled=false` is the boolean), and a
 * field that accepts a string, or that the schema says nothing about, keeps
 * the text, so `postcode=02139` survives (ADR 071 §3). A value that does not
 * fit is refused, pointing at the JSON form.
 */
export const typedValue = (schema: ZodLike | undefined, text: string, label: string): unknown => {
  const value = scalarFrom(schema, text, label);
  if (value instanceof ZitadelError) {
    throw value;
  }
  return value;
};

/** `text` read as JSON for the entry `label`, or an error that offers the plain form. */
export const jsonValue = (text: string, label: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ZitadelError("E_VALIDATION", `${label}:= expects JSON, got "${text}"`, {
      hint: `Quote a JSON value, e.g. ${label}:=30, ${label}:=true, or ${label}:='{"a":1}'. For a plain string use ${label}=${text}.`,
    });
  }
};
