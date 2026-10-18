const written = new WeakMap<Element, ReadonlySet<string>>();

/**
 * Brings an element's attributes in line with `attributes`: sets each one and
 * removes those it wrote earlier that are no longer present. Angular templates
 * can only bind attribute names written out in the template, so the shared
 * attribute map is applied here instead, once per change-detection pass.
 */
export function writeAttributes(element: Element, attributes: Readonly<Record<string, string>>) {
  for (const name of written.get(element) ?? []) {
    if (!(name in attributes)) element.removeAttribute(name);
  }
  for (const [name, value] of Object.entries(attributes)) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }
  written.set(element, new Set(Object.keys(attributes)));
}
