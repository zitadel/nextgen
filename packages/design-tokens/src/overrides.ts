/**
 * Hand-written supplements that Figma's published Variables don't cover.
 *
 * The build script (`scripts/build.ts`) merges these into the same emitted
 * surface as the Figma-sourced tokens, namespaced under `--zl-*` so they're
 * indistinguishable to consumers. Anything authored here is a deliberate
 * decision documented inline; if a value belongs to the design system it
 * should be added to Figma and pulled via sync instead. Each entry stays here
 * only until Figma publishes its equivalent — then delete it and let the sync
 * surface it (as `container` already does).
 *
 * Mode handling (current PR):
 *   - The default surface is dark mode, applied at `:root` and mirrored on
 *     `[data-theme="dark"]` (orchestrator sets `data-theme="dark"` on
 *     `<html>` so a tenant page that already sets `data-theme="light"`
 *     doesn't accidentally inherit dark colours).
 *   - `[data-theme="light"]` is reserved as an empty selector — same shape
 *     of overrides will be appended here once Figma publishes a light mode.
 *     Consumers don't change.
 */

/** Categories the build script emits as `--zl-*` CSS variables and `tokens.*` typed exports. */
export interface DesignTokenOverrides {
  /**
   * Re-exposed Figma primitives the design system references by primitive
   * name (e.g. `color/gray/600`) without a semantic alias. Atoms that need
   * the raw shade for a state Figma doesn't name semantically — most
   * famously the Button's hovered / pressed Primary background — read these
   * directly. Values mirror `figma.tokens.json#primitives.color.gray`.
   */
  colorPrimitive: ColorPrimitiveTokens;
  font: FontTokens;
  motion: MotionTokens;
  focus: FocusTokens;
  breakpoint: BreakpointTokens;
}

export interface ColorPrimitiveTokens {
  gray: {
    "50": string;
    "75": string;
    "100": string;
    "200": string;
    "300": string;
    "400": string;
    "500": string;
    "600": string;
    "700": string;
    "800": string;
    "900": string;
  };
}

export interface FontTokens {
  family: {
    /**
     * Brand sans-serif (Arimo). System fallbacks at the tail keep unbranded
     * environments readable. Tenants override the face via branding URLs.
     */
    sans: string;
    /** Heading face. Same family as `sans` (Arimo), rendered bold by the chrome. */
    heading: string;
    /** Code blocks and any monospaced data display. */
    mono: string;
  };
}

export interface MotionTokens {
  duration: {
    instant: string;
    fast: string;
    base: string;
    slow: string;
  };
  easing: {
    standard: string;
    decelerate: string;
    accelerate: string;
  };
}

export interface FocusTokens {
  /** Outline width applied by the orchestrator's `*:focus-visible` rule. */
  width: string;
  /** Distance between the focus ring and the element edge. */
  offset: string;
  /** Figma token path used to resolve the focus ring colour at build time. */
  colorToken: string;
}

export interface BreakpointTokens {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  "2xl": string;
  "3xl": string;
  "4xl": string;
}

export const overrides: DesignTokenOverrides = {
  colorPrimitive: {
    gray: {
      "50": "#0f0f11",
      "75": "#252528",
      "100": "#37373a",
      "200": "#484a57",
      "300": "#686883",
      "400": "#82829c",
      "500": "#9e9eb2",
      "600": "#cfcfde",
      "700": "#bfbfcf",
      "800": "#e1e1e7",
      "900": "#f4f4f6",
    },
  },
  font: {
    family: {
      sans: '"Arimo", system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
      heading: '"Arimo", system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
      mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
  },
  motion: {
    duration: {
      instant: "0ms",
      fast: "120ms",
      base: "200ms",
      slow: "320ms",
    },
    easing: {
      standard: "cubic-bezier(0.2, 0, 0, 1)",
      decelerate: "cubic-bezier(0, 0, 0, 1)",
      accelerate: "cubic-bezier(0.3, 0, 1, 1)",
    },
  },
  focus: {
    width: "2px",
    offset: "2px",
    colorToken: "color/border/default white",
  },
  breakpoint: {
    xs: "26.5625rem",
    sm: "40rem",
    md: "48rem",
    lg: "64rem",
    xl: "80rem",
    "2xl": "96rem",
    "3xl": "120rem",
    "4xl": "160rem",
  },
};
