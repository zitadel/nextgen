import { ChevronRight, Plus, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { SchemaDesignationBadge } from "./schema-designation-badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { FieldOptionalIndicator } from "@/components/ui/field-optional-indicator";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { SchemaFormControls } from "@/features/schemas/use-schema-form";
import {
  type ArrayField,
  fieldCount,
  inputAttributes,
  type ObjectField,
  type SchemaField,
  type ValueField,
} from "@/features/schemas/model";
import {
  type ArrayDraft,
  attributeJson,
  type Draft,
  fieldHints,
  fieldPath,
  filledCount,
  newRow,
  type ObjectDraft,
  rowPath,
} from "@/features/schemas/schema-form";

/** How one form lays its fields out; the fields themselves are the same everywhere. */
export interface SchemaFieldsLayout {
  orientation: "vertical" | "responsive";
  /** The row a label and its `Optional` marker sit in. */
  labelRow: string;
  label?: string;
  /** Width of a text input or a select. */
  control?: string;
  /** Something a form says under one value's control, past its help and error. */
  belowValue?: (
    field: ValueField,
    path: string,
    draft: string,
    onChange: (draft: string) => void,
  ) => ReactNode;
}

// An object with more properties than this starts closed, unless it needs attention.
const COLLAPSE_ABOVE = 8;

// Each level of an object sets its fields in, which a phone runs out of: below
// this many, a group takes no more of the width.
const INDENT_LEVELS = 4;

// A `Select` cannot hold an empty value, so "Not set" has one of its own.
const NOT_SET = "__not_set__";

/**
 * The controls of a user schema, one per field and in groups for objects and
 * arrays: everything the Add user sheet and the edit card render from a schema.
 */
export function SchemaFields({
  root,
  draft,
  onChange,
  form,
  layout,
  disabled = false,
}: {
  root: ObjectField;
  draft: ObjectDraft;
  onChange: (draft: ObjectDraft) => void;
  form: SchemaFormControls;
  layout: SchemaFieldsLayout;
  disabled?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const { attempts } = form;
  // A rejected submit says why at the first field that needs fixing.
  useEffect(() => {
    if (attempts === 0 || !container.current) return;
    focusFirstError(container.current);
  }, [attempts]);

  return (
    <div ref={container} className="contents">
      <TooltipProvider delayDuration={300}>
        <ObjectChildren
          field={root}
          draft={draft}
          path=""
          onChange={onChange}
          form={form}
          layout={layout}
          disabled={disabled}
        />
      </TooltipProvider>
    </div>
  );
}

/**
 * Moves focus to the first error: its invalid control, or, for an error on a whole
 * group, the group's first control, down to its `Add` button when it has no input.
 */
function focusFirstError(container: HTMLElement) {
  const first = container.querySelector<HTMLElement>(
    "[aria-invalid=true], [data-slot=field-error]",
  );
  if (first?.dataset.slot !== "field-error") {
    first?.focus();
    return;
  }
  const group = first.closest("[data-slot=field-set], [data-slot=field]");
  const target =
    group?.querySelector<HTMLElement>(
      "input:not(:disabled), [role=combobox]:not(:disabled), [role=switch]:not(:disabled)",
    ) ?? group?.querySelector<HTMLElement>("button:not(:disabled)");
  target?.focus();
}

interface ControlProps<F extends SchemaField = SchemaField, D extends Draft = Draft> {
  field: F;
  draft: D;
  path: string;
  onChange: (draft: D) => void;
  form: SchemaFormControls;
  layout: SchemaFieldsLayout;
  disabled: boolean;
}

function ObjectChildren({
  field,
  draft,
  path,
  onChange,
  ...shared
}: ControlProps<ObjectField, ObjectDraft>) {
  return field.fields.map((child) => (
    <SchemaFieldControl
      key={child.key}
      field={child}
      draft={draft.fields[child.key] ?? ""}
      path={fieldPath(path, child.key)}
      onChange={(next) => onChange({ ...draft, fields: { ...draft.fields, [child.key]: next } })}
      {...shared}
    />
  ));
}

function SchemaFieldControl({ field, draft, ...props }: ControlProps) {
  if (typeof draft !== "string" && draft.kind === "locked") {
    // A switch keeps its place for a stored value it cannot show.
    if (field.kind === "value" && field.inputType === "boolean") {
      return <ValueFieldRow field={field} draft="" locked={draft.value} {...props} />;
    }
    return (
      <LockedField field={field} value={draft.value} form={props.form} layout={props.layout} />
    );
  }
  if (field.kind === "opaque") {
    return <LockedField field={field} value={undefined} form={props.form} layout={props.layout} />;
  }
  if (field.kind === "object" && typeof draft !== "string" && draft.kind === "object") {
    return <ObjectGroup field={field} draft={draft} {...props} />;
  }
  if (field.kind === "array" && typeof draft !== "string" && draft.kind === "array") {
    return <ArrayGroup field={field} draft={draft} {...props} />;
  }
  if (field.kind === "value" && typeof draft === "string") {
    return <ValueFieldRow field={field} draft={draft} {...props} />;
  }
  return null;
}

/**
 * Optional: a real choice not to answer, which a nullable field also has wherever
 * `null` can be written: on create and inside an array, but not through a merge patch.
 */
function isOptional(field: SchemaField, form: SchemaFormControls): boolean {
  if (!field.required) return true;
  return field.kind !== "opaque" && field.nullable && (form.mode === "create" || !!form.inArray);
}

/**
 * A field's label, with the property it stands for in a tooltip: what the API, the
 * CLI and the schema call it. `open` also shows it from the field's own control.
 */
function PropertyName({
  field,
  open,
  onOpenChange,
}: {
  field: SchemaField;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Tooltip open={open} onOpenChange={onOpenChange}>
      <TooltipTrigger asChild>
        <span>{field.label}</span>
      </TooltipTrigger>
      <TooltipContent sideOffset={4} className="font-mono">
        {field.attributePath}
      </TooltipContent>
    </Tooltip>
  );
}

/** Marks the property people are found by, which a form must not leave to guesswork. */
function IdentifierBadge({ field }: { field: SchemaField }) {
  return field.identifier ? <SchemaDesignationBadge designation="x-identifier" /> : null;
}

/**
 * Shows a field's property name on tabbing into its control, as hovering the label
 * does; typing hides it. The returned props go on the row around the control.
 */
function useTabbedPropertyName() {
  const [open, setOpen] = useState(false);
  return {
    open,
    setOpen,
    rowProps: {
      onKeyUp: (event: KeyboardEvent) => {
        if (event.key === "Tab") setOpen(true);
      },
      onKeyDown: () => setOpen(false),
      onBlur: () => setOpen(false),
    },
  };
}

/** One attribute: label and `Optional` marker, its control, help and error beneath. */
function ValueFieldRow({
  field,
  draft,
  path,
  onChange,
  form,
  layout,
  disabled,
  locked,
}: ControlProps<ValueField, string> & { locked?: unknown }) {
  const id = useId();
  const error = form.errorFor(path);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const propertyId = `${id}-property`;
  const hints = fieldHints(field);
  const invalid = Boolean(error) || form.inRefusedGroup(path);
  const name = useTabbedPropertyName();

  return (
    <Field orientation={layout.orientation} {...name.rowProps}>
      {/* The marker is a sibling of the label, not part of it, so the accessible
          name stays the field name; requiredness reaches AT via `required`. */}
      <div className={layout.labelRow}>
        <FieldLabel htmlFor={id} className={layout.label}>
          <PropertyName field={field} open={name.open} onOpenChange={name.setOpen} />
        </FieldLabel>
        <IdentifierBadge field={field} />
        {isOptional(field, form) && <FieldOptionalIndicator />}
      </div>
      <FieldContent>
        <ValueInput
          id={id}
          field={field}
          draft={draft}
          path={path}
          onChange={onChange}
          form={form}
          layout={layout}
          disabled={disabled}
          locked={locked}
          invalid={invalid}
          describedBy={[
            error ? errorId : undefined,
            hints.length > 0 ? hintId : undefined,
            propertyId,
          ]
            .filter(Boolean)
            .join(" ")}
        />
        <span id={propertyId} className="sr-only">
          {field.attributePath}
        </span>
        <FieldHints id={hintId} hints={hints} />
        <ErrorLine id={errorId} path={path} form={form} />
        {layout.belowValue?.(field, path, draft, onChange)}
      </FieldContent>
    </Field>
  );
}

/** A field's error beneath its control; only the form's own checks announce themselves. */
function ErrorLine({ id, path, form }: { id: string; path: string; form: SchemaFormControls }) {
  const error = form.errorFor(path);
  if (!error) return null;
  return (
    <FieldError id={id} role={form.isSilentError(path) ? undefined : "alert"}>
      {error}
    </FieldError>
  );
}

function FieldHints({ id, hints }: { id?: string; hints: string[] }) {
  if (hints.length === 0) return null;
  return <FieldDescription id={id}>{hints.join(" ")}</FieldDescription>;
}

/** The control for one value: a switch, a select, or an input. */
function ValueInput({
  id,
  field,
  draft,
  path,
  onChange,
  form,
  layout,
  disabled,
  locked,
  invalid,
  describedBy,
  label,
}: ControlProps<ValueField, string> & {
  id: string;
  locked?: unknown;
  invalid: boolean;
  describedBy?: string;
  /** For a control with no label of its own: a row of an array. */
  label?: string;
}) {
  if (field.options) {
    return (
      <EnumSelect
        id={id}
        field={field}
        options={field.options}
        draft={draft}
        path={path}
        onChange={onChange}
        form={form}
        layout={layout}
        disabled={disabled}
        invalid={invalid}
        describedBy={describedBy}
        label={label}
      />
    );
  }
  if (field.inputType === "boolean") {
    const isLocked = locked !== undefined;
    return (
      <div className="flex items-center gap-2 @md/field-group:min-h-9">
        {/* A switch cannot be read-only, so a locked value disables it. */}
        <Switch
          id={id}
          aria-label={label}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          checked={draft === "true"}
          onCheckedChange={(checked) => {
            form.noteEdit(path);
            onChange(String(checked));
          }}
          required={!isOptional(field, form)}
          disabled={disabled || isLocked}
        />
        {/* The switch reports its own state, so Yes/No is for the eye. A locked
            value shows as stored instead, which the switch cannot report. */}
        <span className="text-foreground text-sm font-medium" aria-hidden={!isLocked}>
          {isLocked ? String(locked) : draft === "true" ? "Yes" : "No"}
        </span>
      </div>
    );
  }
  return (
    <Input
      id={id}
      name={field.key}
      aria-label={label}
      {...inputAttributes(field)}
      value={draft}
      disabled={disabled}
      required={!isOptional(field, form)}
      // A required nullable can't be cleared on edit, so an empty one is stored `null`.
      placeholder={
        field.placeholder ??
        (form.mode === "edit" && !form.inArray && field.required && field.nullable
          ? "Not set"
          : undefined)
      }
      aria-invalid={invalid || undefined}
      // `aria-invalid` says the field is wrong; this says why.
      aria-describedby={describedBy}
      className={layout.control}
      onChange={(event) => {
        form.noteEdit(path);
        onChange(event.target.value);
      }}
      // Read on every native `input` event: `onChange` skips one that leaves the
      // value as it was, such as the last step of clearing a partial date.
      onInput={(event) => form.noteUnreadable(path, event.currentTarget.validity.badInput)}
      onBlur={() => form.noteBlur(path)}
    />
  );
}

/**
 * A select of the schema's allowed values. A stored value outside them is offered
 * too, so it shows as what it is and stays until someone picks another.
 */
function EnumSelect({
  id,
  field,
  options,
  draft,
  path,
  onChange,
  form,
  layout,
  disabled,
  invalid,
  describedBy,
  label,
}: ControlProps<ValueField, string> & {
  id: string;
  options: unknown[];
  invalid: boolean;
  describedBy?: string;
  label?: string;
}) {
  const optional = isOptional(field, form);
  const values = options.map((option) => JSON.stringify(option));
  const outside = draft !== "" && !values.includes(draft);
  return (
    <Select
      value={draft === "" && optional ? NOT_SET : draft}
      disabled={disabled}
      onValueChange={(next) => {
        form.reveal(path);
        onChange(next === NOT_SET ? "" : next);
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        aria-required={!optional}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`w-full ${layout.control ?? ""}`}
      >
        <SelectValue placeholder="Select a value" />
      </SelectTrigger>
      <SelectContent>
        {optional && <SelectItem value={NOT_SET}>Not set</SelectItem>}
        {outside && <SelectItem value={draft}>{optionLabel(draft)}</SelectItem>}
        {values.map((value) => (
          <SelectItem key={value} value={value}>
            {optionLabel(value)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function optionLabel(json: string): string {
  const value: unknown = JSON.parse(json);
  return typeof value === "string" ? value : json;
}

/** An object: its own legend and marker over its fields, set in from the form's edge. */
function ObjectGroup({
  field,
  draft,
  legend,
  action,
  ...props
}: ControlProps<ObjectField, ObjectDraft> & { legend?: string; action?: ReactNode }) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const error = props.form.errorFor(props.path);
  const hints = legend ? [] : fieldHints(field);
  const count = fieldCount(field);
  const indented = props.path.split(".").length <= INDENT_LEVELS;
  const [open, setOpen] = useState(
    () => count <= COLLAPSE_ABOVE || props.form.hasProblemWithin(props.path),
  );
  // Stays open once opened for an error, so correcting it does not close it mid-typing.
  const mustOpen = props.form.showsErrorWithin(props.path);
  if (mustOpen && !open) setOpen(true);
  // A row of an array has its own remove action and stays open: it is one item.
  const expanded = legend !== undefined || open || mustOpen;

  return (
    <Collapsible asChild open={expanded} onOpenChange={setOpen}>
      <FieldSet
        className="min-w-0 gap-3"
        aria-describedby={
          [hints.length > 0 ? hintId : undefined, error ? errorId : undefined]
            .filter(Boolean)
            .join(" ") || undefined
        }
      >
        <FieldLegend variant="label" className="mb-3 flex w-full items-center gap-2">
          {legend !== undefined ? (
            <span className={props.layout.label}>{legend}</span>
          ) : (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <CollapsibleTrigger
                    disabled={mustOpen}
                    className={`flex items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${props.layout.label ?? ""}`}
                  >
                    {field.label}
                    <ChevronRight
                      className={`text-muted-foreground size-4 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
                      aria-hidden
                    />
                  </CollapsibleTrigger>
                </TooltipTrigger>
                <TooltipContent sideOffset={4} className="font-mono">
                  {field.attributePath}
                </TooltipContent>
              </Tooltip>
              {isOptional(field, props.form) && <FieldOptionalIndicator />}
              {!expanded && (
                <span className="text-muted-foreground text-xs font-normal">
                  {filledCount(field, draft)} of {count} set
                </span>
              )}
            </>
          )}
          {action}
        </FieldLegend>
        <FieldHints id={hintId} hints={hints} />
        <CollapsibleContent>
          <FieldGroup className={indented ? "border-border gap-4 border-l pl-4" : "gap-4"}>
            <ObjectChildren field={field} draft={draft} {...props} />
          </FieldGroup>
        </CollapsibleContent>
        <ErrorLine id={errorId} path={props.path} form={props.form} />
      </FieldSet>
    </Collapsible>
  );
}

/** An array: one control per item, each removable, and a button for one more. */
function ArrayGroup({
  field,
  draft,
  path,
  onChange,
  form,
  layout,
  disabled,
}: ControlProps<ArrayField, ArrayDraft>) {
  const titleId = useId();
  const errorId = `${titleId}-error`;
  const hintId = `${titleId}-hint`;
  const hints = fieldHints(field);
  const error = form.errorFor(path);
  const rowForm = { ...form, inArray: true };
  const name = useTabbedPropertyName();
  // An object row is already in the content column, so it takes no second label column.
  const objectRowLayout: SchemaFieldsLayout = {
    ...layout,
    orientation: "vertical",
    labelRow: "flex w-full flex-wrap items-center gap-2",
  };
  // `minItems` holds only of a present array: an optional one can still be emptied.
  const canRemove = !field.required || draft.rows.length > (field.minItems ?? 0);
  const canAdd = field.maxItems === undefined || draft.rows.length < field.maxItems;

  const remove = (row: ArrayDraft["rows"][number]) => {
    form.forget(rowPath(path, row));
    form.reveal(path);
    onChange({ ...draft, rows: draft.rows.filter((other) => other.id !== row.id) });
  };

  return (
    <Field
      orientation={layout.orientation}
      aria-labelledby={titleId}
      // A row of objects names its own fields as they are tabbed into.
      {...(field.item.kind === "value" ? name.rowProps : {})}
      aria-describedby={
        [hints.length > 0 ? hintId : undefined, error ? errorId : undefined]
          .filter(Boolean)
          .join(" ") || undefined
      }
    >
      <div className={layout.labelRow}>
        <FieldTitle id={titleId} className={layout.label}>
          <PropertyName field={field} open={name.open} onOpenChange={name.setOpen} />
        </FieldTitle>
        {isOptional(field, form) && <FieldOptionalIndicator />}
      </div>
      <FieldContent className="gap-2">
        {draft.rows.map((row, index) => {
          const number = index + 1;
          const removeLabel = `Remove ${field.item.label} ${number}`;
          const setRow = (next: Draft) =>
            onChange({
              ...draft,
              rows: draft.rows.map((other) =>
                other.id === row.id ? { ...other, draft: next } : other,
              ),
            });
          const removeButton = (
            <RemoveRow
              label={removeLabel}
              disabled={disabled || !canRemove}
              onClick={() => remove(row)}
            />
          );
          const item = field.item;
          const shared = { path: rowPath(path, row), form: rowForm, layout, disabled };

          if (item.kind === "value" && typeof row.draft === "string") {
            return (
              <ValueRow
                key={row.id}
                field={item}
                draft={row.draft}
                onChange={setRow}
                label={`${field.item.label} ${number}`}
                action={removeButton}
                {...shared}
              />
            );
          }
          if (
            item.kind === "object" &&
            typeof row.draft !== "string" &&
            row.draft.kind === "object"
          ) {
            return (
              <ObjectGroup
                key={row.id}
                field={item}
                draft={row.draft}
                onChange={setRow}
                legend={`${field.item.label} ${number}`}
                action={removeButton}
                {...shared}
                layout={objectRowLayout}
              />
            );
          }
          return (
            <div key={row.id} className="flex flex-col gap-2">
              <SchemaFieldControl field={item} draft={row.draft} onChange={setRow} {...shared} />
              <div className="flex justify-end">{removeButton}</div>
            </div>
          );
        })}
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || !canAdd}
            onClick={() => {
              form.noteEdit(path);
              onChange({ ...draft, rows: [...draft.rows, newRow(field, form.mode === "create")] });
            }}
          >
            <Plus aria-hidden />
            Add {sentenceLabel(field.itemNoun)}
          </Button>
        </div>
        <FieldHints id={hintId} hints={hints} />
        <ErrorLine id={errorId} path={path} form={form} />
      </FieldContent>
    </Field>
  );
}

/** `Tags` reads as `tags` mid-sentence; `SSO keys` keeps its capitals. */
function sentenceLabel(label: string): string {
  return /^\p{Lu}\p{Ll}/u.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

function RemoveRow({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="shrink-0"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <X aria-hidden />
    </Button>
  );
}

/** A row of an array of values: its control, its remove button, then its error. */
function ValueRow({
  field,
  draft,
  path,
  onChange,
  form,
  layout,
  disabled,
  label,
  action,
}: ControlProps<ValueField, string> & { label: string; action: ReactNode }) {
  const id = useId();
  const errorId = `${id}-error`;
  const error = form.errorFor(path);
  return (
    <div className="flex flex-col gap-1.5">
      {/* The row takes the form's control width, so the button stays by its input. */}
      <div className={`flex items-center gap-2 ${layout.control ?? ""}`}>
        <div className="min-w-0 flex-1">
          <ValueInput
            id={id}
            label={label}
            field={field}
            draft={draft}
            path={path}
            onChange={onChange}
            form={form}
            layout={{ ...layout, control: undefined }}
            disabled={disabled}
            invalid={Boolean(error) || form.inRefusedGroup(path)}
            describedBy={error ? errorId : undefined}
          />
        </div>
        {action}
      </div>
      <ErrorLine id={errorId} path={path} form={form} />
    </div>
  );
}

/**
 * A property that is only read here: its stored JSON, or a dash for none, and where
 * to change it. A form never writes one, so nothing here can store the wrong shape.
 */
function LockedField({
  field,
  value,
  form,
  layout,
}: {
  field: SchemaField;
  value: unknown;
  form: SchemaFormControls;
  layout: SchemaFieldsLayout;
}) {
  const titleId = useId();
  const absent = value === undefined || value === null;
  return (
    <Field orientation={layout.orientation} aria-labelledby={titleId}>
      <div className={layout.labelRow}>
        <FieldTitle id={titleId} className={layout.label}>
          <PropertyName field={field} />
        </FieldTitle>
        <IdentifierBadge field={field} />
        {isOptional(field, form) && <FieldOptionalIndicator />}
      </div>
      <FieldContent>
        {form.mode === "edit" &&
          (absent ? (
            <span className="text-muted-foreground text-sm">—</span>
          ) : (
            <pre
              // Scrollable, so reachable by keyboard.
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region needs focus to scroll
              tabIndex={0}
              className={`bg-background border-input max-h-60 overflow-auto rounded-md border px-2.5 py-2 font-mono text-xs break-words whitespace-pre-wrap ${layout.control ?? ""}`}
            >
              {attributeJson(value)}
            </pre>
          ))}
        <FieldDescription>
          {field.description ? `${field.description} ` : ""}
          {form.mode === "edit"
            ? "This property can’t be edited here. Use the CLI or API."
            : "This property can’t be set here. Use the CLI or API."}
        </FieldDescription>
      </FieldContent>
    </Field>
  );
}
