/**
 * Orchestrator surface: the `<zitadel-login>`, `<zitadel-logout>`, and
 * `<zitadel-session>` elements and their supporting primitives. Importing this
 * barrel side-effect-registers the elements.
 */

import "./zitadel-login.js";
import "./zitadel-logout.js";
import "./zitadel-session.js";

export { ZitadelLogin } from "./zitadel-login.js";
export { ZitadelLogout } from "./zitadel-logout.js";
export { ZitadelSession } from "./zitadel-session.js";
export {
  applyBrandingTokens,
  buildBrandingStylesheet,
  resolveTheme,
} from "./branding-to-tokens.js";
export { ThemeController, type ResolvedTheme, type ThemeMode } from "./theme-controller.js";
export { applyFontUrl } from "./font-loader.js";
// `createLiquidEngine` is intentionally NOT re-exported: it returns LiquidJS'
// `Liquid` type, whose declarations reference Node ambient types (`NodeJS`),
// which would force every browser consumer of this package to install
// `@types/node` under `skipLibCheck: false`. It's an internal rendering detail
// of `<zitadel-login>` — import it directly from `./liquid.js` within the
// package. `TEMPLATE_NAMES` is sourced from its own liquidjs-free module for
// the same reason (re-exporting it from `liquid.js` would pull that `Liquid`
// import back into the public declaration bundle).
export { TEMPLATE_NAMES } from "./template-names.js";
export { en, de, it, builtinLocales, businessLocales, type Locale } from "./locales/index.js";
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
