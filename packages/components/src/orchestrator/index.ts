/**
 * Orchestrator surface: the `<zitadel-login>` and `<zitadel-logout>`
 * elements and their supporting primitives. Importing this barrel
 * side-effect-registers the elements.
 */

import "./zitadel-login.js";
import "./zitadel-logout.js";

export { ZitadelLogin } from "./zitadel-login.js";
export { ZitadelLogout } from "./zitadel-logout.js";
export {
  applyBrandingTokens,
  buildBrandingStylesheet,
  resolveTheme,
} from "./branding-to-tokens.js";
export { ThemeController, type ResolvedTheme } from "./theme-controller.js";
export { applyFontUrl } from "./font-loader.js";
export { createLiquidEngine, TEMPLATE_NAMES } from "./liquid.js";
export { en, de, builtinLocales, type Locale } from "./locales/index.js";
export {
  patchMandatoryGates,
  mandatoryGatesMarkerComment,
  MANDATORY_GATES_MARKER,
} from "./mandatory-gates.js";
export { createSanitiser } from "./sanitiser.js";
export { default as defaultTemplate } from "./templates/default.liquid";
export { default as layoutChromeCss } from "./templates/layout-chrome.css?inline";
export { startFlow, submitStep, getCurrentStep } from "./api-client.js";
export { validateBranding, type BrandingValidationResult } from "./branding-validator.js";
export type {
  Branding,
  BrandingAssets,
  BrandingAttribution,
  BrandingPalette,
  BrandingShape,
  BrandingTheme,
  BrandingTypography,
  FlowLayout,
} from "./branding.js";
export type {
  FlowError,
  FlowIdentity,
  FlowMessage,
  LiquidContext,
} from "./template-context.js";
