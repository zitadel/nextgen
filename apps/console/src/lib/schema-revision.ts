import { isRecord } from "./record";
import {
  type ObjectField,
  type SchemaField,
  schemaFields,
  schemaSignInSummary,
  type UserSchema,
} from "./schema";
import {
  draftForRevision,
  formRoot,
  type ObjectDraft,
  storedValueFits,
  validateDraft,
} from "./schema-form";

/** A stored attribute the target revision does not declare. */
export interface RemovedAttribute {
  /** Its attribute path, as the API and the CLI name it (`contact.fax`, `phones.0.fax`). */
  name: string;
  path: string[];
  value: unknown;
  /** The target sets `additionalProperties: false`, so the move can't keep it. */
  mustRemove: boolean;
  /** Inside an array, which a merge patch can only replace: its field's change removes it. */
  inArray?: boolean;
}

/**
 * What moving one user to another revision of their schema asks for. A preview,
 * since the API has no dry run: the server decides when the move is submitted.
 */
export interface RevisionMove {
  /** Every field of the target, which the form holds whether it shows them or not. */
  root: ObjectField;
  /** The form's starting point, without what must leave an array. */
  draft: ObjectDraft;
  /** The top-level fields to put in front of the administrator. */
  review: Set<string>;
  removed: RemovedAttribute[];
  /** The stored attributes that carry over as they are. */
  kept: Record<string, unknown>;
  /** What changes about signing in, which the server neither detects nor blocks. */
  signInChanges: string[];
}

/** The read of a schema document's own `properties`, whatever the customer wrote. */
function propertiesOf(node: Record<string, unknown>): Record<string, unknown> {
  return isRecord(node.properties) ? node.properties : {};
}

/** Whether `patternProperties` covers a key; a pattern this browser can't compile may. */
function patternCovers(node: Record<string, unknown>, key: string): boolean {
  if (!isRecord(node.patternProperties)) return false;
  return Object.keys(node.patternProperties).some((pattern) => {
    try {
      return new RegExp(pattern, "u").test(key);
    } catch {
      return true;
    }
  });
}

/**
 * The stored values the target doesn't declare. In an array only what must go is
 * listed: there is no removing one key by a merge patch, so nothing else is offered.
 * A row is read only where the form has a field that can write the array back.
 */
function removedAttributes(
  node: Record<string, unknown>,
  field: SchemaField | undefined,
  stored: unknown,
  parent: string[] = [],
  inArray = false,
): RemovedAttribute[] {
  if (Array.isArray(stored)) {
    if (field?.kind !== "array" || !isRecord(node.items)) return [];
    const items = node.items;
    return stored.flatMap((item, index) =>
      removedAttributes(items, field.item, item, [...parent, String(index)], true),
    );
  }
  if (!isRecord(stored)) return [];
  const properties = propertiesOf(node);
  return Object.entries(stored)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, value]): RemovedAttribute[] => {
      if (value === undefined) return [];
      const path = [...parent, key];
      const property = properties[key];
      if (!Object.hasOwn(properties, key)) {
        if (patternCovers(node, key)) return [];
        const mustRemove = node.additionalProperties === false;
        if (inArray && !mustRemove) return [];
        return [{ name: path.join("."), path, value, mustRemove, ...(inArray && { inArray }) }];
      }
      if (!isRecord(property)) return [];
      const child =
        field?.kind === "object" ? field.fields.find((entry) => entry.key === key) : undefined;
      return removedAttributes(property, child, value, path, inArray);
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
  const properties = propertiesOf(current);
  if (!Object.hasOwn(properties, field.key)) return stored === undefined;
  const declared = properties[field.key];
  if (field.kind !== "object" || !isRecord(declared)) return false;
  const within = isRecord(stored) ? stored : {};
  return field.fields.some((child) => holdsNewField(child, declared, within[child.key]));
}

/** Every leaf's `x-unique` scope, by its attribute path. */
function uniqueRules(node: Record<string, unknown>, parent = ""): Record<string, unknown> {
  const rules: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(propertiesOf(node))) {
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

/** What the two revisions disagree on about how a user signs in. */
export function signInChanges(current: UserSchema, target: UserSchema): string[] {
  const changes: string[] = [];
  if (current["x-identifier"] !== target["x-identifier"]) changes.push("the sign-in identifier");
  if (schemaSignInSummary(current) !== schemaSignInSummary(target)) {
    changes.push("the sign-in methods");
  }
  if (sortedJson(uniqueRules(current)) !== sortedJson(uniqueRules(target))) {
    changes.push("the uniqueness rules");
  }
  return changes;
}

/**
 * Compares a user's attributes with the target revision.
 *
 * A field is up for review when its stored value does not fit, when the form
 * would refuse it as it starts, and when a key must leave one of its arrays, since
 * the field's change is what writes the array back. So is a field new in the target,
 * or an object holding one, while a value must go: that may be a rename, whose new
 * name is optional as often as not, and the value would be lost. Otherwise a new
 * optional field is nothing the move needs, and stays out of the way.
 */
export function planRevisionMove(
  current: UserSchema | undefined,
  target: UserSchema,
  attributes: Record<string, unknown>,
): RevisionMove {
  const root = formRoot(schemaFields(target));
  const removed = removedAttributes(target, root, attributes);
  const leavingRows = removed.filter((entry) => entry.inArray);
  const fitted = leavingRows.reduce<unknown>(
    (value, entry) => withoutPath(value, entry.path),
    attributes,
  ) as Record<string, unknown>;
  const draft = draftForRevision(root, fitted);
  const refused = [...validateDraft(root, draft, "edit", draft).keys()];
  const valueMustGo = removed.some((entry) => entry.mustRemove && !entry.inArray);
  const review = new Set(
    root.fields
      .filter(
        (entry) =>
          !storedValueFits(entry, attributes[entry.key]) ||
          refused.some((path) => path === entry.key || path.startsWith(`${entry.key}.`)) ||
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
    review,
    removed,
    kept,
    signInChanges: current ? signInChanges(current, target) : [],
  };
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
