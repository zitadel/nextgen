/**
 * `{% fallback_ui %}` runtime patcher.
 *
 * Per `docs/design/branding/validator.md` §Runtime safety net:
 *
 *   "After the template finishes rendering, the tag inspects the produced DOM
 *    and appends:
 *      - Any required `fields[*]` without a matching `<zl-field>`.
 *      - Any required `gates[*]` without a matching consumer.
 *      - A `<zl-submit>` if none was reached."
 *
 * Implementation: the LiquidJS `{% fallback_ui %}` tag emits a unique
 * marker comment. After Liquid renders, this patcher parses the produced
 * HTML into a `<template>`, builds any missing atoms as real DOM elements,
 * replaces the marker with them, and serialises back to a string.
 *
 * Building elements via the DOM (`document.createElement` + `setAttribute`)
 * delegates HTML attribute escaping to the browser's serialiser — no manual
 * string-escaping in this module.
 */
import type { CreateFlow201Step } from "@zitadel-nextgen/api/generated/model";

import type { Locale } from "./locales/en.js";

export const FALLBACK_UI_MARKER = "ZL_FALLBACK_UI";

export const fallbackUiMarkerComment = `<!--${FALLBACK_UI_MARKER}-->`;

export function patchFallbackUi(
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
    for (const [name, field] of Object.entries(step.fields)) {
      if (!field.required) continue;
      if (hasFieldFor(fragment, name)) continue;
      additions.push(buildField(name, field.text_key, field.type, locale, field.required));
    }
  }

  if (step.actions && !fragment.querySelector("zl-submit")) {
    const primary = Object.entries(step.actions).find(([, action]) => action.primary);
    if (primary) {
      const [name, action] = primary;
      additions.push(buildSubmit(name, action.text_key, locale));
    }
  }

  if (step.gates) {
    for (const [name, gate] of Object.entries(step.gates)) {
      if (!gate.required || gate.satisfied) continue;
      const tagName = `zl-${gate.provider || "captcha"}`;
      if (fragment.querySelector(tagName)) continue;
      additions.push(buildGate(name, gate));
    }
  }

  if (!fragment.querySelector("zl-error")) {
    additions.push(buildErrorOutlet());
  }

  return additions;
}

function hasFieldFor(fragment: DocumentFragment, name: string): boolean {
  // We avoid a CSS attribute selector here so we don't have to worry about
  // escaping arbitrary characters in `name` (which comes from the step JSON).
  // Walking the small set of <zl-field> nodes is fine.
  for (const field of fragment.querySelectorAll("zl-field")) {
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
    if (node.nodeValue?.trim() === FALLBACK_UI_MARKER) {
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
  const el = document.createElement("zl-submit");
  el.setAttribute("action", name);
  el.setAttribute("label", lookup(locale, textKey ?? "submit.continue"));
  return el;
}

function buildErrorOutlet(): Element {
  return document.createElement("zl-error");
}

function buildGate(name: string, gate: any): Element {
  const tagName = `zl-${gate.provider || "captcha"}`;
  const el = document.createElement(tagName);
  el.setAttribute("name", name);
  if (gate.config) {
    el.setAttribute("config", JSON.stringify(gate.config));
  }
  return el;
}

function lookup(locale: Locale, key: string): string {
  return locale[key] ?? key;
}
