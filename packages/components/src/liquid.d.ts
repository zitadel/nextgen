/** Ambient type for `.liquid` template files imported as raw strings. */
declare module "*.liquid" {
  const template: string;
  export default template;
}
