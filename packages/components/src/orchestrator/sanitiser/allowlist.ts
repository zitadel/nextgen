/**
 * What a template may contain once sanitised, on top of the sanitiser's own
 * safe HTML: every `<zl-*>` atom, the attributes templates use, and the tags
 * that are dropped. Both sanitisers start from their library's standard set
 * (the browser's default Sanitizer configuration, DOMPurify's HTML profile)
 * and apply these lists, so plain HTML such as `<b>` or `<table>` keeps working.
 */
import { manifestRegistry } from "../../manifests.js";

/**
 * Standard HTML tags that templates may use as structural chrome around
 * `<zl-*>` atoms. The sanitisers allow most of them already; listing them
 * keeps them allowed whatever a library default leaves out (such as `<img>`).
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
  "hidden",
  "width",
  "height",
  "loading",
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
export const ELEMENTS: readonly string[] = [
  ...new Set([...STRUCTURAL_TAGS, ...manifestRegistry.map((manifest) => manifest.tag)]),
];

/**
 * The attributes a template may use, each once: the common ones, every atom's,
 * and the ARIA ones. `data-*` is allowed as a whole, so none is listed: the
 * Sanitizer API rejects a configuration that lists one, or any attribute twice.
 */
export const ATTRIBUTES: readonly string[] = [
  ...new Set([
    ...COMMON_ATTRS,
    ...manifestRegistry.flatMap((manifest) => manifest.attrs),
    ...ARIA_ATTRS,
  ]),
].filter((attribute) => !attribute.startsWith("data-"));

/**
 * Tags dropped together with their content.
 */
export const REMOVED_TAGS: readonly string[] = ["script", "style", "iframe"];

/**
 * Tags dropped while their content stays: templates use `<zl-*>` atoms for
 * controls, and a stray `<button>Go</button>` keeps its text.
 */
export const UNWRAPPED_TAGS: readonly string[] = ["object", "embed", "form", "input", "button"];
