/**
 * The attributes that hold a link or an image URL. An atom attribute whose name
 * ends in `-href` (such as `forgot-password-href`) counts too.
 */
const LINK_ATTRIBUTES: ReadonlySet<string> = new Set(["href", "src", "srcset"]);

/**
 * The URL schemes a link in a template may not use.
 */
const UNSAFE_SCHEMES: ReadonlySet<string> = new Set(["javascript:", "vbscript:", "data:"]);

/**
 * Whether an attribute holds a link a template may not carry, read the way a
 * browser reads a link, so `" java\tscript:"` counts too.
 *
 * @param element - The element that carries it.
 * @param attribute - The attribute.
 * @returns `true` for a `javascript:`, `vbscript:` or `data:` URL in a link
 *   attribute, other than a `data:` image.
 */
function isUnsafeLink(element: Element, attribute: Attr): boolean {
  const { name, value } = attribute;
  if (!LINK_ATTRIBUTES.has(name) && !name.endsWith("-href")) {
    return false;
  }
  if (element.localName === "img" && name === "src" && value.trimStart().startsWith("data:")) {
    return false;
  }
  return UNSAFE_SCHEMES.has(URL.parse(value, document.baseURI)?.protocol ?? "");
}

/**
 * Removes every link a template may not carry from sanitised markup.
 *
 * The HTML Sanitizer API strips `javascript:` only from the browser's own
 * navigating attributes, such as `href` on `<a>`. An atom that renders a link
 * from its own attribute (`<zl-pill href>`, `<zl-field forgot-password-href>`)
 * would still follow it, so both sanitisers run this over their output.
 *
 * @param root - The sanitised markup's container.
 * @returns Nothing; the attributes are removed in place.
 */
export function dropUnsafeLinks(root: ParentNode): void {
  for (const element of root.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (isUnsafeLink(element, attribute)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
}
