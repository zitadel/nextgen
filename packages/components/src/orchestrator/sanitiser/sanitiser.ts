/**
 * Turns untrusted template output into markup that is safe to render.
 */
export interface Sanitiser {
  /**
   * Sanitises one rendered template.
   *
   * @param html - The untrusted markup.
   * @returns The markup with everything outside the allowlist removed.
   */
  sanitise(html: string): string;
}
