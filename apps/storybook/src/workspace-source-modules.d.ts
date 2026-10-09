/**
 * Storybook resolves `@zitadel/components` to its
 * TS source via the `@zitadel/source` condition so the dev server runs from
 * source with HMR. That pulls the atoms' source into this typecheck program,
 * which then sees their non-JS imports: shadow CSS via `?inline` and the
 * orchestrator's `.liquid` templates. These ambient declarations mirror
 * `packages/components/src/{css-inline,liquid}.d.ts` so those imports type.
 */
declare module "*.css?inline" {
  const css: string;
  export default css;
}

declare module "*.liquid" {
  const template: string;
  export default template;
}
