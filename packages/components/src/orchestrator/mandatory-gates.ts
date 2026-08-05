/**
 * `{% mandatory_gates %}` runtime patcher.
 *
 * Per `docs/design/branding/validator.md` §Runtime safety net:
 *
 *   "After the template finishes rendering, the tag inspects the produced DOM
 *    and appends:
 *      - Any required `fields[*]` without a matching `<zl-field>`.
 *      - Any required `gates[*]` without a matching consumer.
 *      - A primary `<zl-button type="submit">` if none was reached."
 *
 * Implementation: the LiquidJS `{% mandatory_gates %}` tag emits a unique
 * marker comment. After Liquid renders, this patcher parses the produced
 * HTML into a `<template>`, builds any missing atoms as real DOM elements,
 * replaces the marker with them, and serialises back to a string.
 *
 * Building elements via the DOM (`document.createElement` + `setAttribute`)
 * delegates HTML attribute escaping to the browser's serialiser — no manual
 * string-escaping in this module.
 */
import type { CreateFlow201Step } from "@zitadel/api/generated/model";

import type { Locale } from "./locales/en.js";

export const MANDATORY_GATES_MARKER = "ZL_MANDATORY_GATES";

/** Every atom tag that participates as a named form field. */
const FIELD_ATOM_TAGS = "zl-field, zl-select, zl-checkbox";

export const mandatoryGatesMarkerComment = `<!--${MANDATORY_GATES_MARKER}-->`;

export function patchMandatoryGates(
  html: string,
  step: CreateFlow201Step,
  locale: Locale,
): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const fragment = template.content;

  const additions = collectMissingAtoms(fragment, step, locale);
  const marker = findMarkerComment(fragment);

  if (marker?.parentNode) {
    for (const node of additions) {
      marker.parentNode.insertBefore(node, marker);
    }
    marker.remove();
  } else {
    for (const node of additions) {
      fragment.appendChild(node);
    }
  }

  return template.innerHTML;
}

function collectMissingAtoms(
  fragment: DocumentFragment,
  step: CreateFlow201Step,
  locale: Locale,
): Element[] {
  const additions: Element[] = [];

  if (step.fields) {
    for (const field of step.fields) {
      if (!field.required) continue;
      if (hasFieldFor(fragment, field.name)) continue;
      additions.push(buildField(field.name, field.text_key, field.type, locale, field.required));
    }
  }

  if (step.actions && !hasPrimaryButton(fragment)) {
    const primary = step.actions.find((action) => action.primary);
    if (primary) {
      additions.push(buildSubmit(primary.name, primary.text_key, locale));
    }
  }

  return additions;
}

function hasPrimaryButton(fragment: DocumentFragment): boolean {
  // CSS attribute selectors with quotes are fine for static values like
  // "primary"; no escaping risk here.
  return Boolean(fragment.querySelector('zl-button[hierarchy="primary"]'));
}

function hasFieldFor(fragment: DocumentFragment, name: string): boolean {
  // A field renders as one of several form-participating atoms depending on
  // its type: <zl-field> (text/email/password), <zl-select> (enum), or
  // <zl-checkbox> (boolean). Match on the shared `name` attribute across all
  // of them — checking only <zl-field> made required <zl-select>/<zl-checkbox>
  // fields look "missing", so the safety net appended a duplicate generic text
  // field at the bottom of the form.
  //
  // We avoid a CSS attribute selector for `name` so we don't have to worry
  // about escaping arbitrary characters in it (it comes from the step JSON);
  // walking the small set of field-atom nodes is fine.
  for (const field of fragment.querySelectorAll(FIELD_ATOM_TAGS)) {
    if (field.getAttribute("name") === name) return true;
  }
  return false;
}

function findMarkerComment(fragment: DocumentFragment): Comment | null {
  const walker = (fragment.ownerDocument ?? document).createTreeWalker(
    fragment,
    NodeFilter.SHOW_COMMENT,
  );
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.nodeValue?.trim() === MANDATORY_GATES_MARKER) {
      return node as Comment;
    }
    node = walker.nextNode();
  }
  return null;
}

function buildField(
  name: string,
  textKey: string | undefined,
  type: string,
  locale: Locale,
  required: boolean,
): Element {
  const el = document.createElement("zl-field");
  el.setAttribute("name", name);
  el.setAttribute("label", lookup(locale, textKey ?? name));
  el.setAttribute("type", type);
  if (required) {
    el.setAttribute("required", "");
  }
  return el;
}

function buildSubmit(name: string, textKey: string | undefined, locale: Locale): Element {
  const el = document.createElement("zl-button");
  el.setAttribute("hierarchy", "primary");
  el.setAttribute("size", "medium");
  el.setAttribute("type", "submit");
  el.setAttribute("block", "");
  el.setAttribute("action", name);
  el.setAttribute("label", lookup(locale, textKey ?? "submit.continue"));
  return el;
}

function lookup(locale: Locale, key: string): string {
  return locale[key] ?? key;
}
