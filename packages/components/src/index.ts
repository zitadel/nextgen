/**
 * `@zitadel/components` — Lit-based atomic web components for the
 * Zitadel auth UI.
 *
 * Importing this module side-effect-registers every shipped `<zl-*>` atom and
 * the `<zitadel-login>` orchestrator. Tree-shake by importing the leaf
 * subpaths instead (e.g. `@zitadel/components/atoms`).
 */

import "./atoms/index.js";
import "./orchestrator/index.js";

export {
  ZlAlert,
  ZlButton,
  ZlCard,
  ZlCheckbox,
  ZlField,
  ZlIcon,
  ZlPageShell,
  ZlPill,
  ZlSelect,
  type IconName,
  type IconSize,
  type IconTone,
  type ZlCheckboxChangeDetail,
  type ZlFieldType,
  type ZlSelectOption,
  type ZlSelectChangeDetail,
  zlAlertManifest,
  zlButtonManifest,
  zlCardManifest,
  zlCheckboxManifest,
  zlFieldManifest,
  zlIconManifest,
  zlPageShellManifest,
  zlPillManifest,
  zlSelectManifest,
} from "./atoms/index.js";

export { manifestRegistry, findManifest, listKnownTags, type AtomManifest } from "./manifests.js";

/**
 * The "Secured with Zitadel" trustmark markup. Exported because the orchestrator
 * injects it into the page shell's footer rather than the shell rendering it, so
 * a shell shown outside a flow (Storybook, a tenant preview) has no other way to
 * paint the real chrome.
 */
export {
  ZITADEL_ATTRIBUTION_LOGOTYPE_SVG,
  zitadelTrustmarkInnerHtml,
} from "./internal/attribution-markup.js";

export { tokens, cssVars, type Tokens, type CssVars } from "./tokens/index.js";
export { baseHostStyles, focusVisibleStyles, t } from "./styles/index.js";

export {
  ZitadelLogin,
  ZitadelLogout,
  ZitadelSession,
  applyBrandingTokens,
  buildBrandingStylesheet,
  resolveTheme,
  ThemeController,
  applyFontUrl,
  createSanitiser,
  validateBranding,
  patchMandatoryGates,
  defaultTemplate,
  layoutChromeCss,
  TEMPLATE_NAMES,
  en,
  de,
  it,
  builtinLocales,
  businessLocales,
  startFlow,
  submitStep,
  getCurrentStep,
  type Branding,
  type BrandingAssets,
  type BrandingAttribution,
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
  type ThemeMode,
} from "./orchestrator/index.js";
