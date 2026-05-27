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
export { en, type Locale } from "./locales/en.js";
export {
  patchRequiredAtoms,
  requiredAtomsMarkerComment,
  REQUIRED_ATOMS_MARKER,
} from "./required-atoms.js";
export { createSanitiser } from "./sanitiser.js";
export { defaultTemplate, layoutChromeCss } from "./templates/default.liquid.js";
export { authFormTemplate } from "./templates/auth-form.liquid.js";
export { passkeyUpsellTemplate } from "./templates/passkey-upsell.liquid.js";
export { signedInTemplate } from "./templates/signed-in.liquid.js";
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
