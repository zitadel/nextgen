/**
 * Fills the rendered field atoms from the step, so a template only has to
 * name a field: `<zl-field name="{{ f.name }}"></zl-field>`.
 *
 * Runs after every commit of `<zitadel-login>`. For each `zl-field`,
 * `zl-select` and `zl-checkbox` whose `name` matches a step field, it writes
 * the attributes the default template used to bind one by one — label, type,
 * placeholder, help, error, test hook, forgot-password link, select options,
 * the server's prefilled value. Writing attributes rather than properties
 * keeps the rendered DOM the same as a fully bound template, so automation
 * and CSS that read attributes see no difference.
 *
 * Two rules keep it from fighting anyone:
 *
 * - An attribute the template wrote itself is never touched. A design that
 *   sets its own `label` or `placeholder` keeps it, and a template that still
 *   binds everything (an ejected design from before this module) renders
 *   exactly as it did.
 * - An attribute is only written when the step's value for it changes. The
 *   widget clears a field's error as the visitor types, and the atoms keep
 *   their own state; re-applying an unchanged value on the next keystroke
 *   commit would undo that.
 */
import type {
  CreateFlow201StepActionsItem,
  CreateFlow201StepFieldsItem,
} from "@zitadel/api/generated/model";

import { hookName } from "../internal/hook-name.js";

import { lookupText } from "./liquid.js";
import type { Locale } from "./locales/en.js";
import type { FlowError } from "./template-context.js";

export type FieldFillContext = {
  fields: readonly CreateFlow201StepFieldsItem[];
  actions: readonly CreateFlow201StepActionsItem[];
  errors: readonly FlowError[];
  locale: Locale;
};

type FillState = {
  /** Attributes present before the first fill: the template's own. */
  authored: ReadonlySet<string>;
  /** Whether the template slotted its own help text. */
  authoredHelp: boolean;
  /** What this module last wrote, per attribute (`null` = removed). */
  applied: Map<string, string | null>;
};

const FIELD_ATOM_TAGS = "zl-field, zl-select, zl-checkbox";
const HELP_MARKER = "data-zl-fill-help";

const states = new WeakMap<Element, FillState>();

export function fillFields(root: ParentNode, ctx: FieldFillContext): void {
  const byName = new Map(ctx.fields.map((field) => [field.name, field]));
  const recover = ctx.actions.find((action) => action.name === "recover");
  for (const el of root.querySelectorAll(FIELD_ATOM_TAGS)) {
    const field = byName.get(el.getAttribute("name") ?? "");
    if (!field) continue;
    fillOne(el, field, recover, ctx);
  }
}

function fillOne(
  el: Element,
  field: CreateFlow201StepFieldsItem,
  recover: CreateFlow201StepActionsItem | undefined,
  ctx: FieldFillContext,
): void {
  let state = states.get(el);
  if (!state) {
    state = {
      authored: new Set(el.getAttributeNames()),
      authoredHelp: el.querySelector(':scope > [slot="help"]') !== null,
      applied: new Map(),
    };
    states.set(el, state);
  }
  const set = (name: string, value: string | null): void => {
    if (state.authored.has(name)) return;
    if (state.applied.has(name) && state.applied.get(name) === value) return;
    state.applied.set(name, value);
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  };
  const flag = (name: string, on: boolean): void => set(name, on ? "" : null);

  const textKey = field.text_key ?? "";
  const error = fieldError(field.name, ctx);
  set("data-testid", `zitadel-field-${hookName(field.name)}`);
  set("label", lookupText(ctx.locale, textKey) ?? textKey);
  flag("invalid", error !== "");
  set("error", error || null);

  switch (el.localName) {
    case "zl-checkbox":
      set("value", "true");
      flag("checked", Boolean(field.value));
      return;
    case "zl-select":
      set("value", text(field.value));
      set(
        "options",
        JSON.stringify(
          (field.validation?.enum ?? []).map((v) => ({ value: text(v), label: text(v) })),
        ),
      );
      flag("required", field.required === true);
      set("placeholder", ctx.locale[`${textKey}.placeholder`] || null);
      return;
    default: {
      const password = field.type === "password";
      set("type", field.type);
      set("value", text(field.value));
      set("autocomplete", field.autocomplete ?? null);
      flag("required", field.required === true);
      set("placeholder", ctx.locale[`${textKey}.placeholder`] || null);
      const forgot = password && recover !== undefined;
      set("forgot-password-href", forgot ? "#" : null);
      set("forgot-password-action", forgot ? recover.name : null);
      set(
        "forgot-password-label",
        forgot ? (lookupText(ctx.locale, recover.text_key ?? "") ?? recover.text_key ?? "") : null,
      );
      if (!state.authoredHelp) fillHelp(el, ctx.locale[`${textKey}.help`] ?? "");
    }
  }
}

/** Same routing as the `fieldError` filter: the field's localized inline error. */
function fieldError(name: string, ctx: FieldFillContext): string {
  for (const err of ctx.errors) {
    if (err.field !== name) continue;
    return err.text_key ? (ctx.locale[err.text_key] ?? err.text_key) : (err.message ?? "");
  }
  return "";
}

/** Help is slotted content, not an attribute, so it gets a marked child span. */
function fillHelp(el: Element, help: string): void {
  let span = el.querySelector(`:scope > [${HELP_MARKER}]`);
  if (!help) {
    span?.remove();
    return;
  }
  if (!span) {
    span = el.ownerDocument.createElement("span");
    span.setAttribute("slot", "help");
    span.setAttribute(HELP_MARKER, "");
    el.appendChild(span);
  }
  if (span.textContent !== help) span.textContent = help;
}

function text(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : String(value);
}
