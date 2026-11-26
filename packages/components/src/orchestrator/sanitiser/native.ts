import { ATTRIBUTES, ELEMENTS } from "./allowlist.js";
import type { Sanitiser } from "./sanitiser.js";

/**
 * Sanitises with the browser's own HTML Sanitizer API, `Element.setHTML()`.
 *
 * The markup is parsed into an inert document, so nothing in it loads or runs
 * and no custom element upgrades while it is sanitised.
 */
export class NativeSanitiser implements Sanitiser {
  private readonly sanitizer: SanitizerConfig = {
    elements: [...ELEMENTS],
    attributes: [...ATTRIBUTES],
    dataAttributes: true,
    comments: false,
  };

  /**
   * Whether this browser has the HTML Sanitizer API.
   *
   * @returns `true` where `Element.setHTML()` exists.
   */
  static isSupported(): boolean {
    return "setHTML" in Element.prototype;
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
