/**
 * `@zitadel/components` for runtimes without a DOM.
 *
 * `package.json` resolves the package root here under the `workerd`, `worker`
 * and `edge-light` export conditions. Those runtimes (Cloudflare Workers,
 * Vercel Edge, web workers) have no `HTMLElement`, `document` or
 * `customElements`, and bundlers target them with the `browser` condition, so
 * Lit resolves to its browser build and throws `HTMLElement is not defined`
 * the moment anything imports it. This entry therefore re-exports only what
 * never loads Lit, and never defines an element.
 *
 * Every name is the same binding as the one `index.ts` exports. The elements,
 * their manifests and anything else that needs Lit stay in `index.ts`:
 * `server.spec.ts` fails if a name here drifts from it.
 */

export { tokens, cssVars, type Tokens, type CssVars } from "./tokens/index.js";

export {
  buildBrandingStylesheet,
  resolveTheme,
} from "./orchestrator/branding-to-tokens.js";
export { TEMPLATE_NAMES } from "./orchestrator/template-names.js";
export {
  en,
  de,
  it,
  builtinLocales,
  businessLocales,
  type Locale,
} from "./orchestrator/locales/index.js";
export { patchMandatoryGates } from "./orchestrator/mandatory-gates.js";
export { startFlow, submitStep, getCurrentStep } from "./orchestrator/api-client.js";
export {
  validateBranding,
  type BrandingValidationResult,
} from "./orchestrator/branding-validator.js";
export { publishedSides, resolveLogoUrl } from "./orchestrator/branding.js";
export type {
  Branding,
  BrandingAttribution,
  BrandingPalette,
  BrandingShape,
  BrandingTheme,
  BrandingThemeSide,
  BrandingTypography,
  FlowLayout,
} from "./orchestrator/branding.js";
export type {
  FlowError,
  FlowIdentity,
  FlowMessage,
  LiquidContext,
} from "./orchestrator/template-context.js";
export type { ResolvedTheme, ThemeMode } from "./orchestrator/theme-controller.js";
