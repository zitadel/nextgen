import { isRecord } from "@/lib/record";
import {
  type ObjectField,
  readProperties,
  type SchemaField,
  type SchemaRevision,
  schemaAuthMethods,
  schemaFields,
  type UserSchema,
} from "@/features/schemas/model";
import {
  draftForRevision,
  formRoot,
  type ObjectDraft,
  refusedAt,
  validateDraft,
} from "@/features/schemas/schema-form";

/** A stored attribute the target revision does not declare. */
export interface RemovedAttribute {
  /** Its attribute path, as the API and the CLI name it (`contact.fax`, `phones.0.fax`). */
  name: string;
  path: string[];
  value: unknown;
  /** The server's dry run refused it, so the move can't keep it. */
  mustRemove: boolean;
  /** Inside an array, which a merge patch can only replace: its field's change removes it. */
  inArray?: boolean;
}

/**
 * What moving one user to another revision of their schema asks for. What must
 * change is the server's answer to a dry run of the move, read onto the target's
 * fields. The rest is what only comparing the two revisions can offer: a new field
 * that may be a rename, and a value the target takes but doesn't declare.
 */
export interface RevisionMove {
  /** Every field of the target, which the form holds whether it shows them or not. */
  root: ObjectField;
  /** The form's starting point, without what must leave an array. */
  draft: ObjectDraft;
  /** The attribute paths the server refused that a field of the target answers for. */
  refused: ReadonlySet<string>;
  /** The top-level fields to put in front of the administrator. */
  review: Set<string>;
  removed: RemovedAttribute[];
  /** The stored attributes that carry over as they are. */
  kept: Record<string, unknown>;
  /** What changes about signing in, which the server neither detects nor blocks. */
  signInChanges: string[];
}

/**
 * The stored values no field of the target stands for. One the server refused has
 * to go, and any other may stay. In an array only what must go is listed: there is
 * no removing one key by a merge patch, so nothing else is offered.
 */
function removedAttributes(
  field: SchemaField,
  stored: unknown,
  refused: ReadonlySet<string>,
  parent: string[] = [],
  inArray = false,
): RemovedAttribute[] {
  if (Array.isArray(stored)) {
    if (field.kind !== "array") return [];
    return stored.flatMap((item, index) =>
      removedAttributes(field.item, item, refused, [...parent, String(index)], true),
    );
  }
  if (!isRecord(stored) || field.kind !== "object") return [];
  return Object.entries(stored)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, value]): RemovedAttribute[] => {
      if (value === undefined) return [];
      const path = [...parent, key];
      const child = field.fields.find((entry) => entry.key === key);
      if (child) return removedAttributes(child, value, refused, path, inArray);
      const name = path.join(".");
      const mustRemove = refusedAt(refused, name);
      if (inArray && !mustRemove) return [];
      return [{ name, path, value, mustRemove, ...(inArray && { inArray }) }];
    });
}

/** A stored value without what one path names, the rest of it as it was. */
function withoutPath(value: unknown, [head, ...tail]: string[]): unknown {
  if (head === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => (String(index) === head ? withoutPath(item, tail) : item));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (key !== head) return [[key, item]];
      return tail.length === 0 ? [] : [[key, withoutPath(item, tail)]];
    }),
  );
}

/** Whether a field is, or an object field holds, one the user's revision doesn't declare. */
function holdsNewField(
  field: SchemaField,
  current: Record<string, unknown>,
  stored: unknown,
): boolean {
  const properties = readProperties(current);
  if (!Object.hasOwn(properties, field.key)) return stored === undefined;
  const declared = properties[field.key];
  if (field.kind !== "object" || !isRecord(declared)) return false;
  const within = isRecord(stored) ? stored : {};
  return field.fields.some((child) => holdsNewField(child, declared, within[child.key]));
}

/** Every leaf's `x-unique` scope, by its attribute path. */
function uniqueRules(node: Record<string, unknown>, parent = ""): Record<string, unknown> {
  const rules: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(readProperties(node))) {
    if (!isRecord(property)) continue;
    const path = parent === "" ? key : `${parent}.${key}`;
    if (property["x-unique"] !== undefined) rules[path] = property["x-unique"];
    Object.assign(rules, uniqueRules(property, path));
  }
  return rules;
}

function sortedJson(record: Record<string, unknown>): string {
  return JSON.stringify(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

/** The enabled sign-in methods and their providers, in no particular order of either. */
function signInMethods(schema: UserSchema): string {
  return JSON.stringify(
    schemaAuthMethods(schema)
      .filter((method) => method.enabled)
      .map((method) => [method.key, [...method.providers].sort()]),
  );
}

/** What the two revisions disagree on about how a user signs in. */
export function signInChanges(current: UserSchema, target: UserSchema): string[] {
  const changes: string[] = [];
  if (current["x-identifier"] !== target["x-identifier"]) changes.push("the sign-in identifier");
  if (signInMethods(current) !== signInMethods(target)) changes.push("the sign-in methods");
  if (sortedJson(uniqueRules(current)) !== sortedJson(uniqueRules(target))) {
    changes.push("the uniqueness rules");
  }
  return changes;
}

/**
 * Compares a user's attributes with the target revision.
 *
 * A field is up for review when the server refused its value, when the form would
 * refuse it as it starts, and when a key must leave one of its arrays, since the
 * field's change is what writes the array back. So is a field new in the target, or
 * an object holding one, while a value must go: that may be a rename, whose new name
 * is optional as often as not, and the value would be lost. Otherwise a new optional
 * field is nothing the move needs, and stays out of the way.
 *
 * @param refused - The attribute paths the server's dry run of this move named.
 */
export function planRevisionMove(
  current: UserSchema | undefined,
  target: UserSchema,
  attributes: Record<string, unknown>,
  refused: readonly string[] = [],
): RevisionMove {
  const root = formRoot(schemaFields(target));
  const removed = removedAttributes(root, attributes, new Set(refused));
  const leaving = removed.filter((entry) => entry.mustRemove).map((entry) => entry.name);
  const answered = new Set(refused.filter((name) => !leaving.some((go) => refusedAt([name], go))));
  const leavingRows = removed.filter((entry) => entry.inArray);
  const fitted = leavingRows.reduce<unknown>(
    (value, entry) => withoutPath(value, entry.path),
    attributes,
  ) as Record<string, unknown>;
  const draft = draftForRevision(root, fitted, answered);
  const refusedByForm = [...validateDraft(root, draft, "edit", draft).keys()];
  const valueMustGo = removed.some((entry) => entry.mustRemove && !entry.inArray);
  const review = new Set(
    root.fields
      .filter(
        (entry) =>
          refusedAt(answered, entry.key) ||
          refusedAt(refusedByForm, entry.key) ||
          leavingRows.some((row) => row.path[0] === entry.key) ||
          (valueMustGo &&
            current !== undefined &&
            holdsNewField(entry, current, attributes[entry.key])),
      )
      .map((entry) => entry.key),
  );
  const declared = new Set(root.fields.map((entry) => entry.key));
  const kept = Object.fromEntries(
    Object.entries(attributes).filter(([key]) => declared.has(key) && !review.has(key)),
  );
  return {
    root,
    draft,
    refused: answered,
    review,
    removed,
    kept,
    signInChanges: current ? signInChanges(current, target) : [],
  };
}

/**
 * Whether a revision was created before another, by the history's own order, newest
 * first. A revision the history leaves out, which the viewer may not read, is no
 * ground to say so.
 */
export function isOlderRevision(revisions: SchemaRevision[], id: string, than: string): boolean {
  const position = revisions.findIndex((revision) => revision.id === id);
  const other = revisions.findIndex((revision) => revision.id === than);
  return position !== -1 && other !== -1 && position > other;
}

/** Whether a field can take a removed attribute's value as it is, for a rename. */
export function canTakeValue(entry: SchemaField, value: unknown): boolean {
  if (entry.kind !== "value" || entry.options || entry.inputType === "boolean") return false;
  return entry.inputType === "number"
    ? typeof value === "number"
    : typeof value === "string" && value !== "";
}

function mergedPatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  // A map, since `__proto__` is a key an attribute can have and an assignment would
  // set the prototype; `fromEntries` defines it as the plain key it is.
  const merged = new Map(Object.entries(base));
  for (const [key, value] of Object.entries(patch)) {
    const existing = merged.get(key);
    merged.set(key, isRecord(existing) && isRecord(value) ? mergedPatch(existing, value) : value);
  }
  return Object.fromEntries(merged);
}

/** One merge patch from the fields' changes and the attributes to delete. */
export function revisionAttributes(
  changes: Record<string, unknown>,
  removals: RemovedAttribute[],
): Record<string, unknown> {
  return removals
    .filter((removal) => !removal.inArray)
    .reduce((merged, { path }) => {
      const nested = path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), null);
      return mergedPatch(merged, nested as Record<string, unknown>);
    }, changes);
}
