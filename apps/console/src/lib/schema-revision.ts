import { isRecord } from "./record";
import {
  type ObjectField,
  type SchemaField,
  schemaFields,
  schemaSignInSummary,
  type UserSchema,
} from "./schema";
import { formRoot, storedValueFits } from "./schema-form";

/** A stored attribute the target revision does not declare. */
export interface RemovedAttribute {
  /** Its attribute path, as the API and the CLI name it (`contact.fax`). */
  name: string;
  path: string[];
  value: unknown;
  /** The target sets `additionalProperties: false`, so the move can't keep it. */
  mustRemove: boolean;
}

/**
 * What moving one user to another revision of their schema asks for. A preview,
 * since the API has no dry run: the server decides when the move is submitted.
 */
export interface RevisionMove {
  /** Every field of the target, which the form holds whether it shows them or not. */
  root: ObjectField;
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

function removedAttributes(
  node: Record<string, unknown>,
  attributes: Record<string, unknown>,
  parent: string[] = [],
): RemovedAttribute[] {
  const properties = propertiesOf(node);
  return Object.entries(attributes)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, value]): RemovedAttribute[] => {
      if (value === undefined || value === null) return [];
      const path = [...parent, key];
      const property = properties[key];
      if (!Object.hasOwn(properties, key)) {
        const mustRemove = node.additionalProperties === false;
        return [{ name: path.join("."), path, value, mustRemove }];
      }
      return isRecord(value) && isRecord(property) ? removedAttributes(property, value, path) : [];
    });
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
 * A field is up for review when its stored value does not fit. So is a field new
 * in the target while a value must go: that may be a rename, whose new name is
 * optional as often as not, and the value would be lost. Otherwise a new optional
 * field is nothing the move needs, and stays out of the way.
 */
export function planRevisionMove(
  current: UserSchema | undefined,
  target: UserSchema,
  attributes: Record<string, unknown>,
): RevisionMove {
  const root = formRoot(schemaFields(target));
  const removed = removedAttributes(target, attributes);
  const declaredNow = current ? propertiesOf(current) : undefined;
  const valueMustGo = removed.some((entry) => entry.mustRemove);
  const review = new Set(
    root.fields
      .filter(
        (entry) =>
          !storedValueFits(entry, attributes[entry.key]) ||
          (valueMustGo &&
            declaredNow !== undefined &&
            !Object.hasOwn(declaredNow, entry.key) &&
            attributes[entry.key] === undefined),
      )
      .map((entry) => entry.key),
  );
  const declared = new Set(root.fields.map((entry) => entry.key));
  const kept = Object.fromEntries(
    Object.entries(attributes).filter(([key]) => declared.has(key) && !review.has(key)),
  );
  return {
    root,
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

function mergeInto(target: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    const existing = target[key];
    if (isRecord(existing) && isRecord(value)) mergeInto(existing, value);
    else target[key] = value;
  }
}

/** One merge patch from the fields' changes and the attributes to delete. */
export function revisionAttributes(
  changes: Record<string, unknown>,
  removals: RemovedAttribute[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  mergeInto(merged, changes);
  for (const { path } of removals) {
    const nested = path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), null);
    mergeInto(merged, nested as Record<string, unknown>);
  }
  return merged;
}
