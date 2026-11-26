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
import type { Config, DOMPurify } from "dompurify";

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
 * of truth for "what attributes does `<zl-field>` accept?". `data-*` is
 * allowed as a whole, so none is listed: the Sanitizer API rejects a
 * configuration that lists one, or lists any attribute twice.
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
  "hidden",
];

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
 * The elements a template may use: the structural tags and every atom.
 */
const ELEMENTS: readonly string[] = [
  ...new Set([...STRUCTURAL_TAGS, ...manifestRegistry.map((manifest) => manifest.tag)]),
];

/**
 * The attributes a template may use, each once: the common ones, every atom's,
 * and the ARIA ones.
 */
const ATTRIBUTES: readonly string[] = [
  ...new Set([
    ...COMMON_ATTRS,
    ...manifestRegistry.flatMap((manifest) => manifest.attrs),
    ...ARIA_ATTRS,
  ]),
];

/**
 * Turns untrusted template output into markup that is safe to render.
 */
export interface Sanitiser {
  /**
   * Sanitises one rendered template.
   *
   * @param html - The untrusted markup.
   * @returns The markup with everything outside the allowlist removed.
   */
  sanitise(html: string): string;
}

/**
 * Sanitises with the browser's own HTML Sanitizer API, `Element.setHTML()`.
 *
 * The markup is parsed into an inert document, so nothing in it loads or runs
 * and no custom element upgrades while it is sanitised.
 */
class NativeSanitiser implements Sanitiser {
  private readonly sanitizer: SanitizerConfig = {
    elements: [...ELEMENTS],
    attributes: [...ATTRIBUTES],
    dataAttributes: true,
    comments: false,
  };

  /**
   * @param html - The untrusted markup.
   * @returns The sanitised markup.
   */
  sanitise(html: string): string {
    const host = document.implementation.createHTMLDocument("").createElement("div");
    host.setHTML(html, { sanitizer: this.sanitizer });
    return host.innerHTML;
  }
}

/**
 * Sanitises with DOMPurify, for browsers without the HTML Sanitizer API.
 *
 * Its configuration matches {@link NativeSanitiser}: only the listed elements
 * and attributes plus `data-*`, and a removed element's content removed with
 * it. DOM clobbering protection is off because the output renders inside the
 * `<zitadel-login>` shadow root, which named access on `document` and `window`
 * cannot reach, and the guard would drop field names such as `name` (#2532).
 *
 * Each call makes an instance for the current `window`: DOMPurify keeps the
 * DOM classes it finds when an instance is made, and a server render (such as
 * Angular's) swaps those globals while it runs.
 */
class DomPurifySanitiser implements Sanitiser {
  private readonly config: Config = {
    ALLOWED_TAGS: [...ELEMENTS, "#text"],
    ALLOWED_ATTR: [...ATTRIBUTES],
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: false,
    KEEP_CONTENT: false,
    RETURN_TRUSTED_TYPE: false,
    SANITIZE_DOM: false,
  };

  private readonly purify: DOMPurify;

  /**
   * @param purify - DOMPurify's factory.
   */
  constructor(purify: DOMPurify) {
    this.purify = purify;
  }

  /**
   * @param html - The untrusted markup.
   * @returns The sanitised markup.
   */
  sanitise(html: string): string {
    return String(this.purify(window).sanitize(html, this.config));
  }
}

/**
 * Creates the sanitiser for this browser: the HTML Sanitizer API where it
 * exists, and otherwise DOMPurify, which then loads in its own chunk. Callers
 * should keep the result.
 *
 * The output is meant for the `<zitadel-login>` shadow root, so callers must
 * not inject it into the document itself.
 *
 * @returns The sanitiser.
 * @internal
 */
export async function createSanitiser(): Promise<Sanitiser> {
  if ("setHTML" in Element.prototype) {
    return new NativeSanitiser();
  }
  const { default: purify } = await import("dompurify");
  return new DomPurifySanitiser(purify);
}
