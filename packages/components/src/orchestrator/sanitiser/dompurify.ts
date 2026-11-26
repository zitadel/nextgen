import type { Config, DOMPurify } from "dompurify";

import { ATTRIBUTES, ELEMENTS } from "./allowlist.js";
import type { Sanitiser } from "./sanitiser.js";

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
export class DomPurifySanitiser implements Sanitiser {
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
  private constructor(purify: DOMPurify) {
    this.purify = purify;
  }

  /**
   * Loads DOMPurify, in its own chunk, and creates the sanitiser.
   *
   * @returns The sanitiser.
   */
  static async load(): Promise<DomPurifySanitiser> {
    const { default: purify } = await import("dompurify");
    return new DomPurifySanitiser(purify);
  }

  /**
   * @param html - The untrusted markup.
   * @returns The sanitised markup.
   */
  sanitise(html: string): string {
    return String(this.purify(window).sanitize(html, this.config));
  }
}
