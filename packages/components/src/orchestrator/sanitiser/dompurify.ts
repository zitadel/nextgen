import type { Config, DOMPurify, UponSanitizeAttributeHookEvent } from "dompurify";

import { HTML_NAMESPACE } from "./allowlist.js";
import type { ElementRule, TemplateConfig } from "./config.js";
import { dropUnsafeLinks } from "./links.js";
import type { Sanitiser } from "./sanitiser.js";

/**
 * Sanitises with DOMPurify, for browsers without the HTML Sanitizer API
 * (Safari), enforcing the same configuration `NativeSanitiser` gives the
 * browser: the browser's built-in safe configuration with the allowlist
 * applied (`config.ts`).
 *
 * DOMPurify walks the tree; the configuration decides what stays:
 *
 * - an element stays when the configuration lists it (by HTML name: the
 *   SVG and MathML roots are removed, so nothing else is reachable), and a
 *   listed unwrapped element is replaced by its children; any other element is
 *   dropped with its content, as `setHTML()` drops it;
 * - an attribute stays by the Sanitizer API's own precedence (Chromium's
 *   `Sanitizer::KeepAttribute`): the element's removed attributes, then the
 *   global ones, then the element's own, then `data-*`;
 * - markup is parsed as `setHTML()` parses it ({@link parse});
 * - comments go, and an attribute keeps its value exactly as written
 *   (`setHTML()` neither trims a value nor drops one that reads like markup,
 *   which DOMPurify does by default, through `SAFE_FOR_XML`);
 * - links are not judged by DOMPurify's scheme list but by `dropUnsafeLinks`
 *   (`links.ts`), which `NativeSanitiser` runs too.
 *
 * Chromium's own sanitizer tests are intentionally not ported. Parity is
 * checked against the browser itself instead: `config.browser.spec.ts` pins
 * the configuration to what the browser holds, and `dompurify.browser.spec.ts`
 * compares this sanitiser's output with `setHTML()` over the shared cases and
 * a generated set of templates.
 *
 * DOM clobbering protection is off because the output renders inside the
 * `<zitadel-login>` shadow root, which named access on `document` and
 * `window` cannot reach, and the guard would drop field names such as `name`
 * (#2532).
 *
 * DOMPurify keeps the DOM classes it finds when an instance is made, and a
 * server render (such as Angular's) swaps those globals while it runs, so the
 * instance is rebuilt whenever `window.Node` is no longer the one it was made
 * with.
 */
export class DomPurifySanitiser implements Sanitiser {
  /**
   * DOMPurify's factory, which binds an instance to a window.
   */
  private readonly purify: DOMPurify;

  /**
   * The configuration both sanitisers enforce.
   */
  private readonly template: TemplateConfig;

  /**
   * The template configuration's elements, by HTML name.
   */
  private readonly rules: ReadonlyMap<string, ElementRule>;

  /**
   * The attributes kept on every element.
   */
  private readonly global: ReadonlySet<string>;

  /**
   * The elements replaced by their children.
   */
  private readonly unwrapped: ReadonlySet<string>;

  /**
   * DOMPurify's configuration for the template configuration.
   */
  private readonly config: Config;

  /**
   * The instance for the current window's DOM classes, rebuilt when they change.
   */
  private instance: { node: typeof Node; purify: DOMPurify } | null = null;

  /**
   * Derives DOMPurify's configuration; use {@link load}.
   *
   * @param purify - DOMPurify's factory.
   * @param template - The configuration both sanitisers enforce.
   */
  private constructor(purify: DOMPurify, template: TemplateConfig) {
    this.purify = purify;
    this.template = template;
    this.rules = new Map(
      template.elements
        .filter((element) => element.namespace === HTML_NAMESPACE)
        .map((element) => [element.name, element]),
    );
    this.global = new Set(template.attributes.map((attribute) => attribute.name));
    this.unwrapped = new Set(template.replaceWithChildrenElements.map((element) => element.name));
    this.config = {
      ALLOWED_TAGS: ["#text", ...this.rules.keys(), ...this.unwrapped],
      ALLOWED_ATTR: [
        ...this.global,
        ...[...this.rules.values()].flatMap((rule) =>
          (rule.attributes ?? []).map((attribute) => attribute.name),
        ),
      ],
      ALLOW_DATA_ATTR: template.dataAttributes,
      ALLOW_ARIA_ATTR: false,
      ALLOWED_URI_REGEXP: /^/,
      KEEP_CONTENT: false,
      RETURN_DOM_FRAGMENT: true,
      SAFE_FOR_XML: false,
      SANITIZE_DOM: false,
    };
  }

  /**
   * Loads DOMPurify and the template configuration, in their own chunks, and
   * creates the sanitiser.
   *
   * @returns The sanitiser.
   */
  static async load(): Promise<DomPurifySanitiser> {
    const [{ default: purify }, { templateConfig }] = await Promise.all([
      import("dompurify"),
      import("./config.js"),
    ]);
    return new DomPurifySanitiser(purify, templateConfig());
  }

  /**
   * Whether an attribute stays on an element, by the Sanitizer API's
   * precedence.
   *
   * @param element - The element's HTML name.
   * @param attribute - The attribute's name.
   * @returns `true` to keep it.
   */
  private keeps(element: string, attribute: string): boolean {
    const rule = this.rules.get(element);
    if (rule?.removeAttributes?.some((removed) => removed.name === attribute)) {
      return false;
    }
    if (this.global.has(attribute)) {
      return true;
    }
    if (rule?.attributes?.some((allowed) => allowed.name === attribute)) {
      return true;
    }
    if (attribute.startsWith("data-")) {
      return this.template.dataAttributes;
    }
    return false;
  }

  /**
   * A DOMPurify instance for the current window, with the hooks that apply
   * the template configuration.
   *
   * @returns The instance.
   */
  private instanceForWindow(): DOMPurify {
    if (this.instance?.node !== window.Node) {
      const purify = this.purify(window);
      purify.addHook("uponSanitizeElement", (node) => {
        if (!(node instanceof Element)) {
          return;
        }
        if (this.unwrapped.has(node.localName)) {
          node.replaceWith(...node.childNodes);
        }
      });
      purify.addHook(
        "uponSanitizeAttribute",
        (node: Element, data: UponSanitizeAttributeHookEvent) => {
          if (!this.keeps(node.localName, data.attrName)) {
            data.keepAttr = false;
            return;
          }
          data.attrValue = node.getAttribute(data.attrName) ?? data.attrValue;
        },
      );
      this.instance = { node: window.Node, purify };
    }
    return this.instance.purify;
  }

  /**
   * Sanitises markup with DOMPurify and the template configuration, then drops
   * unsafe links.
   *
   * @param html - The untrusted markup.
   * @returns The sanitised markup.
   */
  sanitise(html: string): string {
    const fragment = this.instanceForWindow().sanitize(DomPurifySanitiser.parse(html), this.config);
    const host = document.implementation.createHTMLDocument("").createElement("div");
    host.append(fragment);
    dropUnsafeLinks(host);
    return host.innerHTML;
  }

  /**
   * Parses markup the way `setHTML()` does: as a fragment in a body context,
   * in an inert document, so nothing in it loads or runs. An element written
   * with an `is` attribute is rebuilt without it: the Sanitizer API drops the
   * attribute and keeps the element, while a parser that knows customized
   * built-ins (Chromium) would otherwise write the value back on
   * serialisation, and DOMPurify drops such an element whole.
   *
   * @param html - The untrusted markup.
   * @returns The parsed fragment.
   */
  private static parse(html: string): DocumentFragment {
    const inert = document.implementation.createHTMLDocument("");
    const range = inert.createRange();
    range.selectNodeContents(inert.body);
    const fragment = range.createContextualFragment(html);
    for (const element of fragment.querySelectorAll("[is]")) {
      const rebuilt = inert.createElementNS(element.namespaceURI, element.localName);
      for (const attribute of element.attributes) {
        if (attribute.name !== "is") {
          rebuilt.setAttributeNode(attribute.cloneNode() as Attr);
        }
      }
      rebuilt.append(...element.childNodes);
      element.replaceWith(rebuilt);
    }
    return fragment;
  }
}
