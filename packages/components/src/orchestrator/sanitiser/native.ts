import { ATTRIBUTES, ELEMENTS, REMOVED_TAGS, UNWRAPPED_TAGS } from "./allowlist.js";
import type { Sanitiser } from "./sanitiser.js";

/**
 * The namespaces of the tags that are not HTML: the Sanitizer API matches a
 * tag by name and namespace, and `<svg>` and `<math>` are not in the HTML one.
 */
const FOREIGN_NAMESPACES: Readonly<Record<string, string>> = {
  svg: "http://www.w3.org/2000/svg",
  math: "http://www.w3.org/1998/Math/MathML",
};

/** The attributes that hold a link or an image URL. */
const LINK_ATTRIBUTES: ReadonlySet<string> = new Set(["href", "src", "srcset"]);

/** The URL schemes an atom's link may not use. */
const UNSAFE_SCHEMES: ReadonlySet<string> = new Set(["javascript:", "vbscript:", "data:"]);

/**
 * Sanitises with the browser's own HTML Sanitizer API, `Element.setHTML()`.
 *
 * It starts from the browser's default configuration, which already allows
 * safe HTML such as `<b>` and `<table>`, and adds the atoms and attributes in
 * `allowlist.ts`. The markup is parsed into an inert document, so nothing in
 * it loads or runs and no custom element upgrades while it is sanitised.
 *
 * The browser strips `javascript:` only from its own link attributes, such as
 * `href` on `<a>`. An atom that renders a link from its own attribute
 * (`<zl-pill href>`, `<zl-field forgot-password-href>`) would still follow it,
 * so afterwards a `javascript:`, `vbscript:` or `data:` URL is dropped from
 * every `href`, `src` and `srcset` attribute and every `*-href` one, as DOMPurify does
 * (which still allows a `data:` image).
 */
export class NativeSanitiser implements Sanitiser {
  private readonly sanitizer: Sanitizer = NativeSanitiser.configure();

  /**
   * Whether this browser has the HTML Sanitizer API.
   *
   * @returns `true` where `Element.setHTML()` exists.
   */
  static isSupported(): boolean {
    return "setHTML" in Element.prototype;
  }

  /**
   * The browser's default configuration with the allowlist applied. A tag the
   * default already allows is left as it is: allowing it again would replace
   * its own attributes, such as `start` on `<ol>`.
   *
   * @returns The configured sanitizer.
   */
  private static configure(): Sanitizer {
    const sanitizer = new Sanitizer();
    const defaults = new Set(
      sanitizer
        .get()
        .elements?.map((element) => (typeof element === "string" ? element : element.name)),
    );
    for (const element of ELEMENTS.filter((name) => !defaults.has(name))) {
      sanitizer.allowElement(element);
    }
    for (const attribute of ATTRIBUTES) {
      sanitizer.allowAttribute(attribute);
    }
    for (const element of REMOVED_TAGS) {
      const namespace = FOREIGN_NAMESPACES[element];
      sanitizer.removeElement(namespace ? { name: element, namespace } : element);
    }
    for (const element of UNWRAPPED_TAGS) {
      sanitizer.replaceElementWithChildren(element);
    }
    sanitizer.setDataAttributes(true);
    sanitizer.setComments(false);
    return sanitizer;
  }

  /**
   * Whether an attribute holds a link an atom may not follow, read the way a
   * browser reads a link, so `" java\tscript:"` counts too.
   *
   * @param element - The element that carries it.
   * @param attribute - The attribute.
   * @returns `true` for a `javascript:`, `vbscript:` or `data:` URL in a link
   *   attribute, other than a `data:` image.
   */
  private static isUnsafeUrl(element: Element, attribute: Attr): boolean {
    const { name, value } = attribute;
    if (!LINK_ATTRIBUTES.has(name) && !name.endsWith("-href")) {
      return false;
    }
    if (element.localName === "img" && name === "src" && value.trimStart().startsWith("data:")) {
      return false;
    }
    return NativeSanitiser.isUnsafeScheme(value);
  }

  /**
   * @param url - A URL as written.
   * @returns Whether it uses a scheme an atom's link may not use.
   */
  private static isUnsafeScheme(url: string): boolean {
    return UNSAFE_SCHEMES.has(URL.parse(url, document.baseURI)?.protocol ?? "");
  }

  /**
   * @param html - The untrusted markup.
   * @returns The sanitised markup.
   */
  sanitise(html: string): string {
    const host = document.implementation.createHTMLDocument("").createElement("div");
    host.setHTML(html, { sanitizer: this.sanitizer });
    for (const element of host.querySelectorAll("*")) {
      for (const attribute of [...element.attributes]) {
        if (NativeSanitiser.isUnsafeUrl(element, attribute)) {
          element.removeAttribute(attribute.name);
        }
      }
    }
    return host.innerHTML;
  }
}
