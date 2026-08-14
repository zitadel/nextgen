/**
 * Vite asset-import declarations for the workbench. Only the suffix the
 * stories actually use — `?raw` for the ejectable design templates — rather
 * than the whole `vite/client` surface (tsconfig pins `types: []`).
 */
declare module "*?raw" {
  const content: string;
  export default content;
}
