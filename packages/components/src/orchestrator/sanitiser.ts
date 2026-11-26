/**
 * Layer 2 of the template security pipeline (`docs/design/flowengine/template-security.md`).
 *
 * Sanitises with the browser's own HTML Sanitizer API (`Element.setHTML()`)
 * where it exists, and loads DOMPurify only where it does not (Safari, older
 * browsers), as Chrome's guidance on sanitising untrusted HTML recommends. Both
 * enforce the same allowlist:
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
import type { Config } from "dompurify";

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
 * The `aria-*` attributes (WAI-ARIA 1.2). The Sanitizer API has no wildcard
 * for them, so both paths list them.
 */
const ARIA_ATTRS: readonly string[] = [
  "aria-activedescendant",
  "aria-atomic",
  "aria-autocomplete",
  "aria-busy",
  "aria-checked",
  "aria-colcount",
  "aria-colindex",
  "aria-colspan",
  "aria-controls",
  "aria-current",
  "aria-describedby",
  "aria-description",
  "aria-details",
  "aria-disabled",
  "aria-errormessage",
  "aria-expanded",
  "aria-flowto",
  "aria-haspopup",
  "aria-hidden",
  "aria-invalid",
  "aria-keyshortcuts",
  "aria-label",
  "aria-labelledby",
  "aria-level",
  "aria-live",
  "aria-modal",
  "aria-multiline",
  "aria-multiselectable",
  "aria-orientation",
  "aria-owns",
  "aria-placeholder",
  "aria-posinset",
  "aria-pressed",
  "aria-readonly",
  "aria-relevant",
  "aria-required",
  "aria-roledescription",
  "aria-rowcount",
  "aria-rowindex",
  "aria-rowspan",
  "aria-selected",
  "aria-setsize",
  "aria-sort",
  "aria-valuemax",
  "aria-valuemin",
  "aria-valuenow",
  "aria-valuetext",
];

/**
 * Loads a sanitiser bound to the current manifest registry. In a browser with
 * `Element.setHTML()` it uses that; elsewhere it imports DOMPurify, in its own
 * chunk, with the same allowlist. Callers should keep the result.
 *
 * The output is meant for the `<zitadel-login>` shadow root, so callers must
 * not inject it into the document itself.
 *
 * @returns A function from untrusted HTML to sanitised HTML.
 * @internal
 */
export async function createSanitiser(): Promise<(html: string) => string> {
  const elements = buildAllowedTagList();
  // Each attribute once, and no `data-*`: `dataAttributes` covers those, and
  // the Sanitizer API rejects a configuration that lists one or repeats one.
  const attributes = [...new Set([...buildAllowedAttrList(), ...ARIA_ATTRS])].filter(
    (attribute) => !attribute.startsWith("data-"),
  );
  if (typeof Element !== "undefined" && "setHTML" in Element.prototype) {
    const sanitizer = { elements, attributes, dataAttributes: true, comments: false };
    return function sanitise(html: string): string {
      // An inert document: nothing in it loads or runs, and no custom element
      // upgrades while the markup is sanitised.
      const host = document.implementation.createHTMLDocument("").createElement("div");
      host.setHTML(html, { sanitizer });
      return host.innerHTML;
    };
  }
  const { default: DOMPurify } = await import("dompurify");
  // DOMPurify's defaults differ from the Sanitizer API's; these match them:
  // only the listed elements and attributes, `data-*`, and a removed
  // element's content removed with it.
  const config: Config = {
    ALLOWED_TAGS: [...elements, "#text"],
    ALLOWED_ATTR: attributes,
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: false,
    KEEP_CONTENT: false,
    RETURN_TRUSTED_TYPE: false,
    // The output renders inside the <zitadel-login> shadow root, which document and window
    // named access cannot reach. The clobbering guard would otherwise drop common field
    // names such as "name" or "title" (#2532).
    SANITIZE_DOM: false,
  };
  return function sanitise(html: string): string {
    // An instance per call, bound to the window as it is now: DOMPurify keeps
    // the DOM classes it finds when an instance is made, and a server render
    // (Angular's, for one) swaps those globals for its own while it runs.
    return String(DOMPurify(window).sanitize(html, config));
  };
}
