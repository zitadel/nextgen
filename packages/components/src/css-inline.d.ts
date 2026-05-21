/** Matched by `@tsdown/css` (build) and Vite `?inline` (dev / vitest). */
declare module "*.css?inline" {
  const css: string;
  export default css;
}
