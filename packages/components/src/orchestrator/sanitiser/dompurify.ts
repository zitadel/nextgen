import type { Config, DOMPurify } from "dompurify";

import { ATTRIBUTES, ELEMENTS, REMOVED_TAGS, UNWRAPPED_TAGS } from "./allowlist.js";
import type { Sanitiser } from "./sanitiser.js";

/**
 * Sanitises with DOMPurify, for browsers without the HTML Sanitizer API.
 *
 * Its HTML profile allows safe HTML such as `<b>` and `<table>`; the allowlist
 * adds the atoms and the attributes their manifests declare. As in
 * {@link NativeSanitiser}, an element outside the allowlist is dropped with its
 * content, and only the unwrapped tags keep theirs. DOM clobbering protection is off because
 * the output renders inside the `<zitadel-login>` shadow root, which named
 * access on `document` and `window` cannot reach, and the guard would drop
 * field names such as `name` (#2532).
 *
 * DOMPurify keeps the DOM classes it finds when an instance is made, and a
 * server render (such as Angular's) swaps those globals while it runs, so the
 * instance is rebuilt whenever `window.Node` is no longer the one it was made
 * with.
 */
export class DomPurifySanitiser implements Sanitiser {
  private readonly config: Config = {
    USE_PROFILES: { html: true },
    ADD_TAGS: [...ELEMENTS],
    ADD_ATTR: [...ATTRIBUTES],
    FORBID_TAGS: [...REMOVED_TAGS],
    KEEP_CONTENT: false,
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: true,
    RETURN_TRUSTED_TYPE: false,
    SANITIZE_DOM: false,
  };

  private readonly purify: DOMPurify;

  private instance: { node: typeof Node; purify: DOMPurify } | null = null;

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
    if (this.instance?.node !== window.Node) {
      const purify = this.purify(window);
      purify.addHook("uponSanitizeElement", (node) => {
        if (node instanceof Element && UNWRAPPED_TAGS.includes(node.localName)) {
          node.replaceWith(...node.childNodes);
        }
      });
      this.instance = { node: window.Node, purify };
    }
    return String(this.instance.purify.sanitize(html, this.config));
  }
}
