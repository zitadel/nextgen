/**
 * Layer 2 of the template security pipeline (`docs/design/flowengine/template-security.md`).
 *
 * Wraps DOMPurify with the configuration the auth-UI templates need:
 *
 * - Allow every `<zl-*>` custom element registered in the manifest registry,
 *   plus the union of attributes declared on each manifest.
 * - Allow common HTML structural / typographic tags used by `default.liquid`.
 * - Strip `on*` event handlers and any `<script>` / `<style>` tags (theming is
 *   orchestrator-owned via `adoptedStyleSheets`).
 *
 * Runs after Liquid finishes rendering and before the HTML is handed to Lit's
 * `unsafeHTML` directive.
 */
import DOMPurify, { type Config } from "dompurify";

import { manifestRegistry } from "../manifests.js";

/**
 * Standard HTML tags that templates may use as structural chrome around
 * `<zl-*>` atoms. Anything outside this list and the manifest registry is
 * stripped at sanitise-time.
 */
const STRUCTURAL_TAGS: readonly string[] = [
  "div",
  "span",
  "p",
  "small",
  "strong",
  "em",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "section",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "article",
  "figure",
  "figcaption",
  "label",
  "fieldset",
  "legend",
];

/**
 * Attributes templates may carry on structural tags. Per-atom attributes are
 * derived from the manifest registry below — manifests are the single source
 * of truth for "what attributes does `<zl-field>` accept?".
 */
const COMMON_ATTRS: readonly string[] = [
  "id",
  "class",
  "role",
  "slot",
  "tabindex",
  "lang",
  "dir",
  "alt",
  "title",
  "src",
  "srcset",
  "sizes",
  "href",
  "target",
  "rel",
  "style",
  "name",
  "for",
  "data-testid",
  "data-theme",
  "hidden",
];

const CUSTOM_TAG_PATTERN = /^zl-[a-z0-9-]+$/;

function buildAllowedTagList(): string[] {
  const set = new Set<string>(STRUCTURAL_TAGS);
  for (const manifest of manifestRegistry) {
    set.add(manifest.tag);
  }
  return [...set];
}

function buildAllowedAttrList(): string[] {
  const set = new Set<string>(COMMON_ATTRS);
  for (const manifest of manifestRegistry) {
    for (const attr of manifest.attrs) {
      set.add(attr);
    }
  }
  return [...set];
}

/**
 * Returns a sanitiser bound to the current manifest registry. Callers should
 * cache the result; rebuilding is cheap but allocates a fresh DOMPurify config.
 */
export function createSanitiser(): (html: string) => string {
  const config: Config = {
    USE_PROFILES: { html: true },
    ADD_TAGS: buildAllowedTagList(),
    ADD_ATTR: buildAllowedAttrList(),
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button"],
    FORBID_ATTR: ["onerror", "onclick", "onload", "onfocus", "onblur"],
    CUSTOM_ELEMENT_HANDLING: {
      tagNameCheck: CUSTOM_TAG_PATTERN,
      attributeNameCheck: /^(?:[a-z][a-z0-9-]*)$/,
      allowCustomizedBuiltInElements: false,
    },
    KEEP_CONTENT: true,
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: true,
    RETURN_TRUSTED_TYPE: false,
  };

  return function sanitise(html: string): string {
    const result = DOMPurify.sanitize(html, config);
    return typeof result === "string" ? result : String(result);
  };
}
