import { ATTRIBUTES, ELEMENTS, REMOVED_TAGS, UNWRAPPED_TAGS } from "./allowlist.js";
import type { Sanitiser } from "./sanitiser.js";

/**
 * Sanitises with the browser's own HTML Sanitizer API, `Element.setHTML()`.
 *
 * It starts from the browser's default configuration, which already allows
 * safe HTML such as `<b>` and `<table>`, and adds the atoms and attributes in
 * `allowlist.ts`. The markup is parsed into an inert document, so nothing in
 * it loads or runs and no custom element upgrades while it is sanitised.
 */
/**
 * The `Sanitizer` methods {@link NativeSanitiser} configures itself with.
 */
const CONFIGURE_METHODS = [
  "get",
  "allowElement",
  "allowAttribute",
  "removeElement",
  "replaceElementWithChildren",
  "setDataAttributes",
  "setComments",
] as const;

export class NativeSanitiser implements Sanitiser {
  private readonly sanitizer: Sanitizer = NativeSanitiser.configure();

  /**
   * Whether this browser has the HTML Sanitizer API as specified today.
   *
   * `Element.setHTML()` alone does not say so: Chrome 105 to 118 shipped an
   * earlier draft with that method and a `Sanitizer` that has none of the
   * methods {@link configure} calls. So every one of them is checked.
   *
   * @returns `true` where `Element.setHTML()` and a configurable `Sanitizer` exist.
   */
  static isSupported(): boolean {
    if (typeof Element === "undefined" || !("setHTML" in Element.prototype)) {
      return false;
    }
    const prototype: unknown = globalThis.Sanitizer?.prototype;
    return (
      typeof prototype === "object" &&
      prototype !== null &&
      CONFIGURE_METHODS.every((method) => typeof Reflect.get(prototype, method) === "function")
    );
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
      sanitizer.removeElement(element);
    }
    for (const element of UNWRAPPED_TAGS) {
      sanitizer.replaceElementWithChildren(element);
    }
    sanitizer.setDataAttributes(true);
    sanitizer.setComments(false);
    return sanitizer;
  }

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
