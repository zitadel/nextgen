/**
 * `@zitadel-nextgen/components` — Lit-based atomic web components for the
 * Zitadel auth UI.
 *
 * Importing this module side-effect-registers every shipped `<zl-*>` atom and
 * the `<zitadel-login>` orchestrator. Tree-shake by importing the leaf
 * subpaths instead (e.g. `@zitadel-nextgen/components/atoms`).
 */

import "./atoms/index.js";
import "./orchestrator/index.js";

export {
  ZlAction,
  ZlError,
  ZlField,
  ZlSubmit,
  type ZlFieldType,
  zlActionManifest,
  zlErrorManifest,
  zlFieldManifest,
  zlSubmitManifest,
} from "./atoms/index.js";

export { manifestRegistry, findManifest, listKnownTags, type AtomManifest } from "./manifests.js";

export { tokens, flattenTokens, type TokenCatalogue } from "./tokens/catalogue.js";
export { cssVar, cssVarRef, type DesignToken } from "./tokens/css-var.js";

export { baseHostStyles } from "./styles/base.js";
export { focusVisibleStyles } from "./styles/focus-ring.js";

export {
  ZitadelLogin,
  ZitadelLogout,
  applyBrandingTokens,
  buildBrandingStylesheet,
  resolveTheme,
  ThemeController,
  applyFontUrl,
  createLiquidEngine,
  createSanitiser,
  validateBranding,
  patchMandatoryGates,
  defaultTemplate,
  layoutChromeCss,
  authFormTemplate,
  TEMPLATE_NAMES,
  en,
  startFlow,
  submitStep,
  getCurrentStep,
  type Branding,
  type BrandingAssets,
  type BrandingPalette,
  type BrandingShape,
  type BrandingTheme,
  type BrandingTypography,
  type BrandingValidationResult,
  type FlowError,
  type FlowIdentity,
  type FlowLayout,
  type FlowMessage,
  type LiquidContext,
  type Locale,
  type ResolvedTheme,
} from "./orchestrator/index.js";
