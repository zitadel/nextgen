import {
  ATTRIBUTES,
  ELEMENTS,
  FOREIGN_NAMESPACES,
  HTML_NAMESPACE,
  REMOVED_TAGS,
  UNWRAPPED_TAGS,
} from "./allowlist.js";
import BROWSER_DEFAULTS from "./browser-defaults.json";

/**
 * An element or attribute name with its namespace, as the HTML Sanitizer API
 * writes one (`null` for an attribute in no namespace).
 */
export type QualifiedName = {
  readonly name: string;
  readonly namespace: string | null;
};

/**
 * What an allowed element may carry beyond the global attributes.
 */
export type ElementRule = QualifiedName & {
  readonly attributes?: readonly QualifiedName[];
  readonly removeAttributes?: readonly QualifiedName[];
};

/**
 * A sanitizer configuration in the shape the HTML Sanitizer API's `get()`
 * returns it: the elements kept (with their own attributes), the attributes
 * kept on every element, and the elements replaced by their children.
 */
export type TemplateConfig = {
  readonly elements: readonly ElementRule[];
  readonly attributes: readonly QualifiedName[];
  readonly replaceWithChildrenElements: readonly QualifiedName[];
  readonly dataAttributes: boolean;
  readonly comments: boolean;
};

/**
 * Names an HTML element or attribute the way the Sanitizer API keys it.
 *
 * @param element - The element's name.
 * @returns The element's qualified name.
 */
function qualifiedElement(element: string): QualifiedName {
  return { name: element, namespace: FOREIGN_NAMESPACES[element] ?? HTML_NAMESPACE };
}

/**
 * The key a qualified name is compared by.
 *
 * @param name - The qualified name.
 * @returns `namespace|name`.
 */
export function keyOf(name: QualifiedName): string {
  return `${name.namespace ?? ""}|${name.name}`;
}

/**
 * The template configuration: the browser's built-in safe configuration
 * (`browser-defaults.json`, what `new Sanitizer().get()` returns) with the
 * allowlist applied exactly as `NativeSanitiser` applies it through the
 * Sanitizer API, so `DomPurifySanitiser` enforces the same rules where the
 * browser has no `setHTML()`:
 *
 * - an allowlisted tag the defaults lack is added with no attributes of its own;
 * - an allowlisted attribute is allowed on every element, and so leaves the
 *   per-element lists (the API keeps the two apart);
 * - a removed or unwrapped tag leaves the element list, and an unwrapped one is
 *   listed for unwrapping;
 * - `data-*` attributes are kept and comments are not.
 *
 * `config.browser.spec.ts` checks it against the browser's own result.
 *
 * @returns The configuration.
 */
export function templateConfig(): TemplateConfig {
  const defaults = BROWSER_DEFAULTS as unknown as TemplateConfig;
  const dropped = new Set(
    [...REMOVED_TAGS, ...UNWRAPPED_TAGS].map((tag) => keyOf(qualifiedElement(tag))),
  );
  const global = [...defaults.attributes];
  const globalKeys = new Set(global.map(keyOf));
  for (const attribute of ATTRIBUTES) {
    const name = { name: attribute, namespace: null };
    if (!globalKeys.has(keyOf(name))) {
      global.push(name);
      globalKeys.add(keyOf(name));
    }
  }
  const elements: ElementRule[] = defaults.elements
    .filter((element) => !dropped.has(keyOf(element)))
    .map((element) => {
      const own = element.attributes?.filter((attribute) => !globalKeys.has(keyOf(attribute)));
      return own === undefined ? element : { ...element, attributes: own };
    });
  const kept = new Set(elements.map(keyOf));
  for (const tag of ELEMENTS) {
    const name = qualifiedElement(tag);
    if (!kept.has(keyOf(name))) {
      elements.push({ ...name, removeAttributes: [] });
      kept.add(keyOf(name));
    }
  }
  return {
    elements,
    attributes: global,
    replaceWithChildrenElements: UNWRAPPED_TAGS.map(qualifiedElement),
    dataAttributes: true,
    comments: false,
  };
}
