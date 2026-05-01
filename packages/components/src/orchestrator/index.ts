/**
 * Orchestrator surface: the `<zitadel-login>` element and its supporting
 * primitives. Importing this barrel side-effect-registers the element.
 */

import "./zitadel-login.js";

export { ZitadelLogin } from "./zitadel-login.js";
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
  patchMandatoryGates,
  mandatoryGatesMarkerComment,
  MANDATORY_GATES_MARKER,
} from "./mandatory-gates.js";
export { createSanitiser } from "./sanitiser.js";
export { defaultTemplate, layoutChromeCss } from "./templates/default.liquid.js";
export { authFormTemplate } from "./templates/auth-form.liquid.js";
export {
  FetchTransport,
  FixtureTransport,
  FlowTransportError,
  WalkingFixtureTransport,
  type FlowTransport,
  type FixtureScript,
  type FetchTransportOptions,
  type FlowDefinition,
  type FlowDefinitionStep,
  type FlowTransitionTarget,
  type StartInput,
  type WalkingFixtureOptions,
} from "./transport.js";
export { validateBranding, type BrandingValidationResult } from "./branding-validator.js";
export type {
  Branding,
  BrandingPalette,
  BrandingShape,
  BrandingTheme,
  BrandingTypography,
  FlowAction,
  FlowError,
  FlowField,
  FlowFieldType,
  FlowGate,
  FlowIdentity,
  FlowLayout,
  FlowMessage,
  FlowResponse,
  FlowStep,
  FlowSsoProvider,
  FlowSubmitInput,
} from "./types.js";
