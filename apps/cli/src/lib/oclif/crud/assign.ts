import { ZitadelError } from "../../errors";
import { jsonValue, refuseProtoKey, setAt, typedValue } from "./document";
import type { BodyField } from "./fields";
import type { Json } from "./types";
import { nodeAt, unwrap, type ZodLike } from "./zod";

/**
 * `--set <path>=<value>` and `--set <path>:=<json>` (ADR 071 §3): one field of
 * the document by its dot path, the path language `--fields` already speaks.
 * A field flag is the documented spelling of one path; `--set` is the general
 * one, in the wire's own names, so a key read from `get --json` can be typed
 * back as it is, and a field no flag can carry is still reachable. `zitadel
 * api` reads its `--field` with the same grammar, so the readers take the flag
 * they report errors under.
 */

/** One `--set` entry, read and checked. */
export type Assignment = Readonly<{
  /** The path as typed (`oidc.client_id`). */
  name: string;
  path: readonly string[];
  value: unknown;
  /** The entry as it came in, for errors. */
  raw: string;
}>;

const usage = (flag: string): string =>
  `Use ${flag} path=value, or ${flag} path:=json for a JSON value (e.g. ${flag} oidc.pkce_enabled=false).`;

/** The fields worth naming to a caller whose path does not exist. */
const knownPaths = (fields: readonly BodyField[], first: string): readonly string[] => {
  const all = fields.map((field) => (field.kind === "record" ? `${field.name}.<key>` : field.name));
  const near = all.filter((path) => path === first || path.startsWith(`${first}.`));
  return near.length > 0 ? near : all;
};

/** What an assignment's plain form can hold at a path, or why it cannot. */
const plainValue = (
  node: ZodLike | undefined,
  text: string,
  name: string,
  fields: readonly BodyField[],
  label: string,
): unknown => {
  const type = unwrap(node)?.def?.type;
  const shape =
    type === "array" ? "a list" : type === "object" || type === "record" ? "an object" : undefined;
  if (shape) {
    const flag = fields.find((field) => field.name === name)?.flag;
    throw new ZitadelError("E_VALIDATION", `${label} ${name} names ${shape}, which takes JSON`, {
      hint: `Set it whole with ${label} '${name}:=<json>'${flag ? `, or give --${flag} once per value` : ""}.`,
    });
  }
  return typedValue(node, text, `${label} ${name}`);
};

/**
 * Read one `--set` entry against the document's schema. With no schema to
 * check against (one the factory cannot introspect), any path is taken and a
 * plain value stays a string. `label` is the flag the entry came with.
 */
export const readAssignment = (
  raw: string,
  document: ZodLike | undefined,
  fields: readonly BodyField[],
  label = "--set",
): Assignment => {
  const json = raw.indexOf(":=");
  const plain = raw.indexOf("=");
  const isJson = json > 0 && json === plain - 1;
  const at = isJson ? json : plain;
  if (at <= 0) {
    throw new ZitadelError("E_VALIDATION", `Invalid ${label} "${raw}"`, { hint: usage(label) });
  }
  const name = raw.slice(0, at);
  const text = raw.slice(at + (isJson ? 2 : 1));
  const path = name.split(".");
  if (path.some((segment) => segment === "")) {
    throw new ZitadelError("E_VALIDATION", `Invalid ${label} path "${name}"`, {
      hint: usage(label),
    });
  }
  refuseProtoKey(path, `${label} ${name}`);
  const located = document === undefined ? { node: undefined, open: true } : nodeAt(document, path);
  if (!located) {
    const paths = knownPaths(fields, path[0] ?? "");
    throw new ZitadelError("E_VALIDATION", `${label} ${name} names no field of this body`, {
      hint: `Fields: ${paths.join(", ")}.`,
      details: { field: name, fields: paths },
    });
  }
  return {
    name,
    path,
    value: isJson
      ? jsonValue(text, `${label} ${name}`)
      : plainValue(located.node, text, name, fields, label),
    raw,
  };
};

/** Every `--set` entry of an invocation, in the order given. */
export const readAssignments = (
  entries: unknown,
  document: ZodLike | undefined,
  fields: readonly BodyField[],
): readonly Assignment[] =>
  (Array.isArray(entries) ? entries : entries === undefined ? [] : [entries]).map((entry) =>
    readAssignment(String(entry), document, fields),
  );

/** An assignment as the fragment of a document it describes. */
export const fragmentOf = (assignment: Assignment): Json =>
  setAt({}, assignment.path, assignment.value);
