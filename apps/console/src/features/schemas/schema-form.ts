import { isRecord } from "@/lib/record";
import {
  type ArrayField,
  attributeValue,
  DECIMAL,
  type FieldRules,
  type ObjectField,
  type SchemaField,
  type ValueField,
} from "@/features/schemas/model";

/**
 * What a schema form holds while it is being filled in, one node per field:
 *
 * - a string for a {@link ValueField}: the input's text, `"true"`/`"false"` for a
 *   switch, a value's JSON for a select, and `""` for nothing.
 * - an object's own fields, plus the stored keys no control writes (`rest`).
 * - an array's rows, each with an id that outlives removing the rows above it, and,
 *   for a stored row, what it came from: only an edit changes what it writes.
 * - `locked`: a stored value no control can show without changing it, and the
 *   whole of an opaque field. Shown, and written back only as it came.
 */
export type Draft = string | ObjectDraft | ArrayDraft | LockedDraft;

export interface ObjectDraft {
  kind: "object";
  fields: Record<string, Draft>;
  rest: Record<string, unknown>;
  /** The fields stored as `null`, which is an answer, where absent is none. */
  nulls?: string[];
}

export interface ArrayDraft {
  kind: "array";
  rows: ArrayRow[];
}

export interface ArrayRow {
  id: number;
  draft: Draft;
  /** The draft a stored row started as; `undefined` for a row added since. */
  initial?: Draft;
  /** The JSON a stored row came from, written back as it was unless edited. */
  stored?: unknown;
}

export interface LockedDraft {
  kind: "locked";
  value: unknown;
  /** A stored `null` the field no longer takes, which a patch must clear or replace. */
  mustClear?: boolean;
}

/** `create` omits what is empty; `edit` deletes it, which a merge patch can only do by `null`. */
export type SchemaFormMode = "create" | "edit";

let nextRowId = 0;

/** A field standing for the whole form, so the walks below need no special root. */
export function formRoot(fields: SchemaField[]): ObjectField {
  return {
    kind: "object",
    key: "",
    attributePath: "",
    label: "",
    required: true,
    nullable: false,
    fields,
  };
}

/** A blank form for a new user: a schema's `default`s filled in, so what is sent is on show. */
export function newDraft(root: ObjectField): ObjectDraft {
  return emptyObject(root, true);
}

/** A blank field. In a new row, a required switch is the `false` it shows. */
function emptyDraft(field: SchemaField, prefill: boolean, inRow = false): Draft {
  const declared = prefill && field.kind !== "opaque" ? field.default : undefined;
  if (declared !== undefined && declared !== null) {
    const draft = storedDraft(field, declared);
    // A default that does not fit the type is the schema's mistake, not a value.
    if (typeof draft === "string" || draft.kind !== "locked") return draft;
  }
  switch (field.kind) {
    case "value":
      return inRow && field.required && isSwitch(field) ? "false" : "";
    case "opaque":
      return { kind: "locked", value: undefined };
    case "object":
      return emptyObject(field, prefill, inRow);
    case "array":
      // Rows for a required array alone: a new row can hold a real `false`, which an
      // optional array nobody touched must not send.
      return {
        kind: "array",
        rows: Array.from({ length: prefill && field.required ? (field.minItems ?? 0) : 0 }, () =>
          newRow(field, prefill),
        ),
      };
  }
}

function emptyObject(field: ObjectField, prefill: boolean, inRow = false): ObjectDraft {
  return {
    kind: "object",
    // An optional object's defaults stay out: filled in, they would read as the
    // administrator having started it, and make its required fields demand answers.
    fields: Object.fromEntries(
      field.fields.map((child) => [child.key, emptyDraft(child, prefill && field.required, inRow)]),
    ),
    rest: {},
  };
}

/** One more row of an array, blank. */
export function newRow(field: ArrayField, prefill = true): ArrayRow {
  nextRowId += 1;
  return { id: nextRowId, draft: emptyDraft(field.item, prefill, true) };
}

/** A stored user's attributes, as the draft that edits them. */
export function draftFromAttributes(
  root: ObjectField,
  attributes: Record<string, unknown>,
): ObjectDraft {
  return storedDraft(root, attributes) as ObjectDraft;
}

/**
 * How a stored value reads as a draft:
 *
 * - `edit` locks a value of the wrong shape for its field: a `"yes"` under a switch
 *   would show as off and be overwritten by a toggle meant as a correction, and a
 *   string under a group has no control to show it in.
 * - `move`, to another revision, starts it blank instead, as that is what the form
 *   is for, and a value outside a select's choices too. Text that can become the
 *   new type stays on show (`"36"` under an integer). An array is written whole: a
 *   row the server took comes back as stored, and one it refused is a row to fill
 *   in like a new one, so what it holds is judged and converted.
 * - `written` holds the JSON as it is, what {@link attributesPatch} compares a move
 *   with: drafts can't tell the stored `"36"` from the `36` its new type needs.
 *
 * `refused` is what the server's dry run of the move named, by attribute path.
 */
type StoredReading = { kind: "edit" } | { kind: "move" | "written"; refused: ReadonlySet<string> };

const EDITING: StoredReading = { kind: "edit" };

/** Whether the server refused the value at a path, or anything inside it. */
export function refusedAt(refused: Iterable<string>, path: string): boolean {
  for (const name of refused) {
    if (name === path || name.startsWith(`${path}.`)) return true;
  }
  return false;
}

function storedDraft(
  field: SchemaField,
  value: unknown,
  reading: StoredReading = EDITING,
  path = "",
): Draft {
  if (reading.kind === "written" && (field.kind !== "object" || !isRecord(value))) {
    const mustClear = value === null && reading.refused.has(path);
    return { kind: "locked", value, ...(mustClear ? { mustClear } : {}) };
  }
  if (value === undefined || value === null) {
    return field.kind === "opaque" ? { kind: "locked", value } : emptyDraft(field, false);
  }
  const misfit = (): Draft =>
    reading.kind === "move" ? emptyDraft(field, false) : { kind: "locked", value };
  switch (field.kind) {
    case "opaque":
      return { kind: "locked", value };
    case "value":
      return storedValueDraft(field, value, misfit, reading);
    case "object": {
      if (!isRecord(value)) return misfit();
      const declared = new Set(field.fields.map((child) => child.key));
      return {
        kind: "object",
        fields: Object.fromEntries(
          field.fields.map((child) => [
            child.key,
            storedDraft(child, value[child.key], reading, fieldPath(path, child.key)),
          ]),
        ),
        rest: Object.fromEntries(Object.entries(value).filter(([key]) => !declared.has(key))),
        nulls: field.fields.filter((child) => value[child.key] === null).map((child) => child.key),
      };
    }
    case "array": {
      if (!Array.isArray(value)) return misfit();
      if (reading.kind === "move") {
        return {
          kind: "array",
          rows: value.map((item, index) => {
            const itemPath = `${path}.${index}`;
            const draft = storedDraft(field.item, item, reading, itemPath);
            nextRowId += 1;
            return refusedAt(reading.refused, itemPath)
              ? { id: nextRowId, draft }
              : { id: nextRowId, draft, initial: draft, stored: item };
          }),
        };
      }
      const drafts = value.map((item) => storedDraft(field.item, item));
      if (drafts.some(isLocked)) return { kind: "locked", value };
      return {
        kind: "array",
        rows: drafts.map((draft, index) => {
          nextRowId += 1;
          return { id: nextRowId, draft, initial: draft, stored: value[index] };
        }),
      };
    }
  }
}

function storedValueDraft(
  field: ValueField,
  value: unknown,
  misfit: () => Draft,
  reading: StoredReading,
): Draft {
  if (typeof value === "object") return misfit();
  if (field.options) {
    const stored = JSON.stringify(value);
    const listed = field.options.some((option) => JSON.stringify(option) === stored);
    return reading.kind === "move" && !listed ? misfit() : stored;
  }
  if (field.inputType === "boolean") {
    return typeof value === "boolean" ? String(value) : misfit();
  }
  return String(value);
}

function isLocked(draft: Draft | undefined): draft is LockedDraft {
  return draft !== undefined && typeof draft !== "string" && draft.kind === "locked";
}

function isSwitch(field: SchemaField): boolean {
  return field.kind === "value" && field.inputType === "boolean" && !field.options;
}

/** A value control's text as it would be sent; `""` is nothing to send. */
function cleaned(field: ValueField, draft: string): string {
  return field.trim ? draft.trim() : draft;
}

/**
 * Whether a field holds no value, stored or entered. `false` is a value; a switch
 * nobody answered is `""`, so it alone does not start an optional object.
 */
function isEmptyDraft(field: SchemaField, draft: Draft): boolean {
  if (typeof draft === "string") {
    return field.kind === "value" ? cleaned(field, draft) === "" : draft === "";
  }
  switch (draft.kind) {
    case "locked":
      return draft.value === undefined || draft.value === null;
    case "object":
      return (
        field.kind === "object" &&
        Object.keys(draft.rest).length === 0 &&
        field.fields.every((child) => {
          const childDraft = draft.fields[child.key];
          return childDraft === undefined || isEmptyDraft(child, childDraft);
        })
      );
    case "array":
      return field.kind === "array" && sentRows(field, draft).length === 0;
  }
}

/**
 * The JSON a draft stands for, or `undefined` for nothing to send. Optional
 * properties are omitted rather than sent empty: an empty string fails the
 * property's `format` and `minLength` instead of reading as absent.
 *
 * A required nullable property sends `null` on create, its only other valid answer.
 */
export function draftValue(field: SchemaField, draft: Draft, mode: SchemaFormMode): unknown {
  if (typeof draft !== "string" && draft.kind === "locked") return draft.value ?? undefined;
  if (field.kind === "opaque") return undefined;
  const none = field.required && field.nullable && mode === "create" ? null : undefined;

  if (field.kind === "value") {
    const text = typeof draft === "string" ? cleaned(field, draft) : "";
    if (isSwitch(field)) {
      if (text === "") return field.required && none === undefined ? false : none;
      return text === "true";
    }
    if (text === "") return none;
    return field.options ? JSON.parse(text) : attributeValue(field, text);
  }
  if (field.kind === "object") {
    if (typeof draft === "string" || draft.kind !== "object") return undefined;
    if (!field.required && isEmptyDraft(field, draft)) return none;
    if (none === null && isEmptyDraft(field, draft)) return null;
    const value: Record<string, unknown> = { ...draft.rest };
    for (const child of field.fields) {
      const built = draftValue(child, draft.fields[child.key] ?? "", mode);
      if (built !== undefined) value[child.key] = built;
    }
    return value;
  }
  if (typeof draft === "string" || draft.kind !== "array") return undefined;
  const items = sentRows(field, draft).map((row) => rowValue(field.item, row));
  if (items.length > 0 || field.required) {
    return items.length === 0 && none === null ? null : items;
  }
  return none;
}

/**
 * The rows an array writes. An array is written whole, so a stored row stays unless
 * it was removed, whatever it holds; a row added since and left blank goes, unless
 * `minItems` needs it and its item can be `null`, which then answers for it.
 */
function sentRows(field: ArrayField, draft: ArrayDraft): ArrayRow[] {
  const { item } = field;
  const holdsValue = (row: ArrayRow) => row.initial !== undefined || !isEmptyDraft(item, row.draft);
  const count = draft.rows.filter(holdsValue).length;
  const nullable = item.kind !== "opaque" && item.nullable;
  const present = field.required || count > 0;
  let missing = nullable && present ? (field.minItems ?? 0) - count : 0;
  return draft.rows.filter((row) => {
    if (holdsValue(row)) return true;
    missing -= 1;
    return missing >= 0;
  });
}

/**
 * The JSON of one row. An array is not merge-patched, so `null` is a value here on
 * edit too, and what the row's edit left alone is written back exactly as stored.
 */
function rowValue(item: SchemaField, row: ArrayRow): unknown {
  return row.initial === undefined
    ? draftValue(item, row.draft, "create")
    : editedStoredValue(item, row.initial, row.draft, row.stored);
}

function editedStoredValue(
  field: SchemaField,
  initial: Draft,
  draft: Draft,
  stored: unknown,
): unknown {
  if (draft === initial) return stored;
  if (
    field.kind !== "object" ||
    !isObjectDraft(initial) ||
    !isObjectDraft(draft) ||
    !isRecord(stored) ||
    isEmptyDraft(field, draft)
  ) {
    return draftValue(field, draft, "create");
  }
  const value: Record<string, unknown> = { ...draft.rest };
  for (const child of field.fields) {
    const built = editedStoredValue(
      child,
      initial.fields[child.key] ?? "",
      draft.fields[child.key] ?? "",
      stored[child.key],
    );
    if (built !== undefined) value[child.key] = built;
  }
  return value;
}

function isObjectDraft(draft: Draft | undefined): draft is ObjectDraft {
  return draft !== undefined && typeof draft !== "string" && draft.kind === "object";
}

/**
 * What a save sends, as the RFC 7386 merge patch `PATCH /users` applies: only
 * what changed, an object as just its changed keys, `null` to delete. An optional
 * switch that was absent and shows off again is no change, so off is not a write;
 * a required one is written as the `false` it shows along with its level.
 */
export function attributesPatch(
  root: ObjectField,
  stored: ObjectDraft,
  draft: ObjectDraft,
): Record<string, unknown> {
  return objectPatch(root, stored, draft);
}

function objectPatch(
  field: ObjectField,
  stored: ObjectDraft,
  draft: ObjectDraft,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const child of field.fields) {
    const change = fieldPatch(child, stored.fields[child.key] ?? "", draft.fields[child.key] ?? "");
    if (change !== undefined) patch[child.key] = change;
  }
  if (Object.keys(patch).length > 0) fillRequiredSwitches(field, stored, draft, patch);
  return patch;
}

/** The server checks `required` against the merged document, so "No" must be stored. */
function fillRequiredSwitches(
  field: ObjectField,
  stored: ObjectDraft,
  draft: ObjectDraft,
  patch: Record<string, unknown>,
) {
  for (const child of field.fields) {
    if (!child.required || patch[child.key] !== undefined) continue;
    if (stored.nulls?.includes(child.key)) continue;
    const storedChild = stored.fields[child.key];
    const draftChild = draft.fields[child.key];
    if (isSwitch(child)) {
      if (storedChild === "" && draftChild !== "true" && !isLocked(draftChild)) {
        patch[child.key] = false;
      }
    } else if (child.kind === "object" && isObjectDraft(storedChild) && isObjectDraft(draftChild)) {
      const nested: Record<string, unknown> = {};
      fillRequiredSwitches(child, storedChild, draftChild, nested);
      if (Object.keys(nested).length > 0) patch[child.key] = nested;
    }
  }
}

function fieldPatch(field: SchemaField, stored: Draft, draft: Draft): unknown {
  if (field.kind === "opaque" || isLocked(draft)) return undefined;
  if (field.kind === "object" && typeof stored !== "string" && stored.kind === "object") {
    if (typeof draft === "string" || draft.kind !== "object") return undefined;
    // Only an optional object with no value left, stored or entered, is deleted
    // whole: `null` would fail a required one, and destroy what a filled one holds.
    if (!field.required && isEmptyDraft(field, draft)) {
      return isEmptyDraft(field, stored) ? undefined : null;
    }
    const patch = objectPatch(field, stored, draft);
    return Object.keys(patch).length > 0 ? patch : undefined;
  }
  const mustClear = isLocked(stored) && stored.mustClear === true;
  if (!mustClear && sameValue(field, stored, draft)) return undefined;
  return draftValue(field, draft, "edit") ?? null;
}

/** Whether two drafts would write the same thing, an off switch reading as absent. */
function sameValue(field: SchemaField, a: Draft, b: Draft): boolean {
  const offIsAbsent = (draft: Draft) =>
    isSwitch(field) && (draft === "false" || (isLocked(draft) && draft.value === false))
      ? ""
      : draft;
  return (
    JSON.stringify(draftValue(field, offIsAbsent(a), "edit") ?? null) ===
    JSON.stringify(draftValue(field, offIsAbsent(b), "edit") ?? null)
  );
}

/** A required field's text when it is left empty. */
export const REQUIRED_MESSAGE = "This field is required.";

/**
 * Every error a draft shows, by {@link fieldPath}. Advisory: never stricter than
 * the server, whose message stays the last word on what it accepts.
 *
 * With `stored`, a value that is as it was stored is not re-judged. A patch asks
 * the server about what it changes, so an old value breaking a rule must not
 * block an unrelated save. Emptiness still counts: the server checks `required`
 * against the merged document, so a missing value fails any save.
 */
export function validateDraft(
  root: ObjectField,
  draft: ObjectDraft,
  mode: SchemaFormMode,
  stored?: ObjectDraft,
): Map<string, string> {
  const errors = new Map<string, string>();
  validateField(root, draft, stored, "", mode, errors);
  return errors;
}

/** A field's key within its parent, stable while the form is filled in. */
export function fieldPath(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`;
}

/** How many of the properties `fieldCount` counts hold something in this draft. */
export function filledCount(field: SchemaField, draft: Draft | undefined): number {
  if (draft === undefined || draft === "") return 0;
  if (typeof draft === "string") return 1;
  switch (draft.kind) {
    case "locked":
      return draft.value === undefined || draft.value === null ? 0 : 1;
    case "array":
      if (field.kind !== "array") return 0;
      return draft.rows.some((row) => filledCount(field.item, row.draft) > 0) ? 1 : 0;
    case "object":
      if (field.kind !== "object") return 0;
      return field.fields.reduce(
        (count, child) => count + filledCount(child, draft.fields[child.key]),
        0,
      );
  }
}

/** A row's path: by its id, since its index moves when one above it goes. */
export function rowPath(parent: string, row: ArrayRow): string {
  return `${parent}.#${row.id}`;
}

function validateField(
  field: SchemaField,
  draft: Draft,
  stored: Draft | undefined,
  path: string,
  mode: SchemaFormMode,
  errors: Map<string, string>,
) {
  if (field.kind === "opaque" || isLocked(draft)) return;
  if (field.kind === "value") {
    if (typeof draft !== "string") return;
    const error = valueError(field, draft, stored, mode);
    if (error) errors.set(path, error);
    return;
  }
  if (field.kind === "object") {
    if (typeof draft === "string" || draft.kind !== "object") return;
    const storedObject =
      stored && typeof stored !== "string" && stored.kind === "object" ? stored : undefined;
    if (isEmptyDraft(field, draft)) {
      const stillNull = storedObject !== undefined && isEmptyDraft(field, storedObject);
      if (!field.required || (field.nullable && (mode === "create" || stillNull))) return;
    }
    for (const child of field.fields) {
      validateField(
        child,
        draft.fields[child.key] ?? "",
        storedObject?.fields[child.key],
        fieldPath(path, child.key),
        mode,
        errors,
      );
    }
    return;
  }
  if (typeof draft === "string" || draft.kind !== "array") return;
  const rows = sentRows(field, draft);
  for (const row of rows) {
    // A stored row nobody touched is written back as it came, so it is not judged.
    if (row.initial !== undefined && row.draft === row.initial) continue;
    // Not merge-patched, so `null` stays a valid answer in a row, as on create.
    validateField(field.item, row.draft, row.initial, rowPath(path, row), "create", errors);
  }
  if (stored && typeof stored !== "string" && stored.kind === "array") {
    if (sameValue(field, stored, draft)) return;
  }
  // A row on show is what falls short: say so there, not as a missing row.
  const shortBy = (field.minItems ?? 0) - rows.length;
  const blank = draft.rows.filter((row) => !rows.includes(row));
  if (field.required && shortBy > 0 && blank.length >= shortBy) {
    for (const row of blank.slice(0, shortBy)) errors.set(rowPath(path, row), REQUIRED_MESSAGE);
    return;
  }
  const error = arrayError(field, rows, mode);
  if (error) errors.set(path, error);
}

function arrayError(field: ArrayField, rows: ArrayRow[], mode: SchemaFormMode): string | undefined {
  // Absent or `null` where the schema lets it be, which no item count applies to.
  if (rows.length === 0 && (!field.required || (field.nullable && mode === "create"))) {
    return undefined;
  }
  if (field.minItems !== undefined && rows.length < field.minItems) {
    return `Add at least ${countOf(field.minItems, "item")}.`;
  }
  if (field.maxItems !== undefined && rows.length > field.maxItems) {
    return `Add at most ${countOf(field.maxItems, "item")}.`;
  }
  if (field.uniqueItems) {
    const values = rows.map((row) => JSON.stringify(rowValue(field.item, row)));
    if (new Set(values).size < values.length) return "Each item must be different.";
  }
  return undefined;
}

function valueError(
  field: ValueField,
  draft: string,
  stored: Draft | undefined,
  mode: SchemaFormMode,
): string | undefined {
  const text = cleaned(field, draft);
  if (text === "") {
    // A switch that is off has answered. `null` answers a nullable one on create,
    // and may be what is stored; clearing one on edit would delete it instead,
    // since `null` is how a merge patch deletes, and that fails `required`.
    if (isSwitch(field)) return undefined;
    if (!field.required) return undefined;
    if (field.nullable && (mode === "create" || stored === draft)) return undefined;
    return REQUIRED_MESSAGE;
  }
  if (stored === draft || field.options || field.inputType === "boolean") return undefined;
  if (field.inputType === "number") return numberError(field, text);
  return textError(field.rules, text);
}

function numberError(field: ValueField, text: string): string | undefined {
  if (!DECIMAL.test(text)) return field.integer ? "Enter a whole number." : "Enter a number.";
  const value = Number(text);
  if (field.integer && !Number.isInteger(value)) return "Enter a whole number.";
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf } = field.rules;
  if (minimum !== undefined && value < minimum) return `Enter ${minimum} or more.`;
  if (maximum !== undefined && value > maximum) return `Enter ${maximum} or less.`;
  if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) {
    return `Enter more than ${exclusiveMinimum}.`;
  }
  if (exclusiveMaximum !== undefined && value >= exclusiveMaximum) {
    return `Enter less than ${exclusiveMaximum}.`;
  }
  if (multipleOf !== undefined && multipleOf > 0) {
    const steps = value / multipleOf;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) return `Enter a multiple of ${multipleOf}.`;
  }
  return undefined;
}

function textError(rules: FieldRules, text: string): string | undefined {
  // Code points, as JSON Schema counts them; `length` counts an emoji twice.
  const length = [...text].length;
  if (rules.minLength !== undefined && length < rules.minLength) {
    return `Enter at least ${countOf(rules.minLength, "character")}.`;
  }
  if (rules.maxLength !== undefined && length > rules.maxLength) {
    return `Enter at most ${countOf(rules.maxLength, "character")}.`;
  }
  if (rules.pattern !== undefined && patternRefuses(rules.pattern, text)) {
    return `Must match ${rules.pattern}.`;
  }
  return rules.format ? formatError(rules.format, text) : undefined;
}

/** A pattern this browser cannot compile is left to the server, which has its own engine. */
function patternRefuses(pattern: string, text: string): boolean {
  try {
    return !new RegExp(pattern, "u").test(text);
  } catch {
    return false;
  }
}

/**
 * The `format`s worth checking before the server does, kept here alone: only
 * where the check cannot refuse what the server takes, and the rest is its to
 * explain. `email` is one address with no display name, angle brackets or padding;
 * non-ASCII and `a@b` are valid, and a quoted local part may hold anything.
 */
function formatError(format: string, text: string): string | undefined {
  if (format === "email" || format === "idn-email") {
    if (text.startsWith('"') || /^[^\s<>@]+@[^\s<>@]+$/.test(text)) return undefined;
    return "Enter one email address, like name@example.com.";
  }
  if (format === "uuid") {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
      ? undefined
      : "Enter a UUID.";
  }
  return undefined;
}

/**
 * The labels of required properties that are absent and that this form cannot
 * write, by which no save can succeed.
 */
export function unwritableRequired(
  field: ObjectField,
  draft: ObjectDraft,
  mode: SchemaFormMode,
): string[] {
  if (isEmptyDraft(field, draft)) {
    // Nothing is asked of its fields where absent or `null` answers for all of them.
    if (!field.required || (field.nullable && mode === "create")) return [];
  }
  return field.fields.flatMap((child) =>
    draft.nulls?.includes(child.key) ? [] : unwritableIn(child, draft.fields[child.key], mode),
  );
}

function unwritableIn(
  field: SchemaField,
  draft: Draft | undefined,
  mode: SchemaFormMode,
): string[] {
  if (field.kind === "opaque") {
    return field.required && isLocked(draft) && draft.value === undefined ? [field.label] : [];
  }
  if (field.kind === "object") {
    return isObjectDraft(draft) ? unwritableRequired(field, draft, mode) : [];
  }
  if (field.kind !== "array" || !draft || typeof draft === "string" || draft.kind !== "array") {
    return [];
  }
  if (field.nullable && mode === "create" && isEmptyDraft(field, draft)) return [];
  // A row it must have has to be sent, filled in or not, even if none is there yet.
  const mustSend = field.required && (field.minItems ?? 0) > 0;
  if (mustSend && draft.rows.length === 0) {
    return unwritableIn(field.item, emptyDraft(field.item, true, true), "create");
  }
  const rows = mustSend ? draft.rows : sentRows(field, draft);
  return rows.flatMap((row) => unwritableIn(field.item, row.draft, "create"));
}

/** What the form says about {@link unwritableRequired}, and where to go instead. */
export function unwritableMessage(labels: string[], next: string): string | undefined {
  if (labels.length === 0) return undefined;
  const names = [...new Set(labels)].join(", ");
  return `This schema requires ${names}, which this form can’t set. Use the CLI or API to ${next}.`;
}

/**
 * The form's own path for a field the server named (`address.city`, `tags.0`), if
 * the form shows it: array indexes count only the rows that were sent.
 */
export function pathOfNamedField(
  root: ObjectField,
  draft: ObjectDraft,
  name: string,
): string | undefined {
  let field: SchemaField = root;
  let node: Draft = draft;
  let path = "";
  for (const segment of name.split(".")) {
    if (field.kind === "object" && typeof node !== "string" && node.kind === "object") {
      const child: SchemaField | undefined = field.fields.find((entry) => entry.key === segment);
      if (!child) return undefined;
      path = fieldPath(path, segment);
      field = child;
      node = node.fields[segment] ?? "";
    } else if (field.kind === "array" && typeof node !== "string" && node.kind === "array") {
      const row: ArrayRow | undefined = sentRows(field, node)[Number(segment)];
      if (!row) return path;
      path = rowPath(path, row);
      field = field.item;
      node = row.draft;
    } else {
      return path;
    }
  }
  return path === "" ? undefined : path;
}

/**
 * A short line on what a field accepts: only what its control does not already
 * say. A switch, a select and an email input say it themselves.
 */
export function fieldHints(field: SchemaField): string[] {
  const own = field.description ? [field.description] : [];
  if (field.kind === "array") return [...own, ...arrayHints(field), ...fieldHints(field.item)];
  if (field.kind !== "value" || field.options || field.inputType === "boolean") return own;
  return [...own, ...ruleHints(field)];
}

function arrayHints(field: ArrayField): string[] {
  const { minItems, maxItems, uniqueItems } = field;
  const count =
    minItems !== undefined && maxItems !== undefined
      ? `${minItems} to ${countOf(maxItems, "item")}.`
      : minItems !== undefined
        ? `At least ${countOf(minItems, "item")}.`
        : maxItems !== undefined
          ? `Up to ${countOf(maxItems, "item")}.`
          : undefined;
  return [...(count ? [count] : []), ...(uniqueItems ? ["Each item must be different."] : [])];
}

/** Formats an input of its own already speaks for. */
const SELF_EVIDENT_FORMATS = new Set(["email", "uri", "url", "date", "phone", "tel"]);

function ruleHints(field: ValueField): string[] {
  const { rules } = field;
  const { minLength, maxLength, minimum, maximum, exclusiveMinimum, exclusiveMaximum } = rules;
  const hints: string[] = [];
  if (minLength !== undefined && maxLength !== undefined) {
    hints.push(`${minLength} to ${countOf(maxLength, "character")}.`);
  } else if (minLength !== undefined) {
    hints.push(`At least ${countOf(minLength, "character")}.`);
  } else if (maxLength !== undefined) {
    hints.push(`Up to ${countOf(maxLength, "character")}.`);
  }
  if (minimum !== undefined && maximum !== undefined) {
    hints.push(`Between ${minimum} and ${maximum}.`);
  } else if (minimum !== undefined) {
    hints.push(`${minimum} or more.`);
  } else if (maximum !== undefined) {
    hints.push(`${maximum} or less.`);
  }
  if (exclusiveMinimum !== undefined) hints.push(`More than ${exclusiveMinimum}.`);
  if (exclusiveMaximum !== undefined) hints.push(`Less than ${exclusiveMaximum}.`);
  if (rules.multipleOf !== undefined) hints.push(`A multiple of ${rules.multipleOf}.`);
  if (rules.pattern !== undefined) hints.push(`Must match ${rules.pattern}.`);
  if (rules.format && !SELF_EVIDENT_FORMATS.has(rules.format)) {
    hints.push(`Format: ${rules.format}.`);
  }
  return hints;
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** A stored value no control can write, for reading. */
export function attributeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "";
}

/** A stored user's attributes, as the draft that moves them to another revision. */
export function draftForRevision(
  root: ObjectField,
  attributes: Record<string, unknown>,
  refused: ReadonlySet<string> = new Set(),
): ObjectDraft {
  return storedDraft(root, attributes, { kind: "move", refused }) as ObjectDraft;
}

/**
 * What a move to another revision writes: {@link attributesPatch}, against what is
 * stored rather than the draft it started as, so `"36"` is still sent as `36`.
 */
export function revisionPatch(
  root: ObjectField,
  attributes: Record<string, unknown>,
  draft: ObjectDraft,
  refused: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  const written = storedDraft(root, attributes, { kind: "written", refused });
  return attributesPatch(root, written as ObjectDraft, draft);
}
