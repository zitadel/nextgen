/**
 * What a template may contain once sanitised, on top of the browser's built-in
 * safe configuration: every `<zl-*>` atom, the attributes templates use, and
 * the tags that are dropped or unwrapped. `NativeSanitiser` applies these to
 * the browser's own configuration, and `config.ts` applies them the same way
 * to a copy of it for `DomPurifySanitiser`, so both sanitise alike.
 */
import { manifestRegistry } from "../../manifests.js";

/**
 * Plain HTML tags templates use that the browser's safe list leaves out.
 * Everything else plain (`<div>`, `<p>`, `<h1>`, `<b>`, `<table>`) is in
 * that list already.
 */
const STRUCTURAL_TAGS: readonly string[] = ["img", "label", "fieldset", "legend"];

/**
 * Attributes templates use that the browser's safe list leaves out on purpose
 * (it cannot judge them): styling hooks, ids, slots and form names. Per-atom
 * attributes come from the manifest registry below — manifests are the single
 * source of truth for "what attributes does `<zl-field>` accept?".
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
 * The WAI-ARIA 1.2 attributes. The browser's safe list has none, and unlike
 * `data-*` the Sanitizer API has no switch that allows them all, so they are
 * named here; without them a template's `aria-*` would be stripped in Chrome
 * and Firefox. The list is fixed by the specification.
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
 * The HTML namespace, which every allowlisted tag is in.
 */
export const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/**
 * The namespaces of the removed tags that are not HTML: the Sanitizer API
 * matches a tag by name and namespace.
 */
export const FOREIGN_NAMESPACES: Readonly<Record<string, string>> = {
  svg: "http://www.w3.org/2000/svg",
  math: "http://www.w3.org/1998/Math/MathML",
};

/**
 * Tags the browser's safe configuration allows that templates may not use,
 * dropped with their content: inline SVG and MathML (atoms such as
 * `<zl-icon>` draw the icons). Everything else the configuration leaves out,
 * such as `<script>`, `<iframe>` or `<video>`, is dropped already.
 */
export const REMOVED_TAGS: readonly string[] = ["svg", "math"];

/**
 * Tags dropped while their content stays: templates use `<zl-*>` atoms for
 * controls, and a stray `<button>Go</button>` keeps its text.
 */
export const UNWRAPPED_TAGS: readonly string[] = ["form", "input", "button"];
