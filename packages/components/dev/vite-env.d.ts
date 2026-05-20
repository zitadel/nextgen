/**
 * Ambient type declarations for Vite-specific import suffixes used by
 * the dev playground. These are not part of the library build.
 */

/** Vite `?raw` imports resolve to a plain string. */
declare module "*.html?raw" {
  const content: string;
  export default content;
}
