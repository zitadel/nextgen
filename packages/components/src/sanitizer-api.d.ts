/**
 * The HTML Sanitizer API (`Element.setHTML()`), which TypeScript's DOM types
 * do not declare yet. Only what `orchestrator/sanitiser.ts` passes is typed:
 * https://wicg.github.io/sanitizer-api/
 */
interface SanitizerConfig {
  /**
   * The elements kept; every other element is removed with its content.
   */
  elements?: readonly string[];
  /**
   * The attributes kept on every element; every other attribute is removed.
   */
  attributes?: readonly string[];
  /**
   * Whether `data-*` attributes are kept.
   */
  dataAttributes?: boolean;
  /**
   * Whether comments are kept.
   */
  comments?: boolean;
}

interface Element {
  /**
   * Parses `html`, removes what the sanitizer does not allow and anything
   * unsafe, and replaces the element's children with the result.
   *
   * @param html - The untrusted markup.
   * @param options - The sanitizer configuration.
   */
  setHTML(html: string, options?: { sanitizer?: SanitizerConfig }): void;
}
