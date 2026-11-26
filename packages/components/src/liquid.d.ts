/** Ambient type for `.liquid` template files imported as raw strings. */
declare module "*.liquid" {
  const template: string;
  export default template;
}

/**
 * Ambient type for a `.liquid` template compiled at build time
 * (`vite-liquid-plugin.ts`) to a render function.
 */
declare module "*.liquid?compiled" {
  const render: import("./orchestrator/template-runtime.js").CompiledTemplate;
  export default render;
}
