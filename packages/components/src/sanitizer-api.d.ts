/**
 * `Element.setHTML()` from the HTML Sanitizer API. TypeScript's DOM types
 * declare its `SanitizerConfig` but not the method yet:
 * https://wicg.github.io/sanitizer-api/
 */
interface Element {
  /**
   * Parses `html`, removes what the sanitizer does not allow and anything
   * unsafe, and replaces the element's children with the result.
   *
   * @param html - The untrusted markup.
   * @param options - The sanitizer configuration.
   */
  setHTML(html: string, options?: { sanitizer?: Sanitizer | SanitizerConfig }): void;
}
