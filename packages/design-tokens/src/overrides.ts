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
  /** Semantic colours the shadcn role set has no name for. */
  colorRole: ColorRoleTokens;
  font: FontTokens;
  motion: MotionTokens;
  focus: FocusTokens;
  breakpoint: BreakpointTokens;
}

/**
 * Roles the design system needs but shadcn does not define. Each is a
 * `{ dark, light }` pair so it flips with the theme like every other colour.
 */
export interface ColorRoleTokens {
  link: { dark: string; light: string };
  warning: { dark: string; light: string };
}

export interface FontTokens {
  family: {
    /**
     * Brand sans-serif (Arimo). System fallbacks at the tail keep unbranded
     * environments readable. Tenants override the face via branding URLs.
     */
    sans: string;
    /**
     * Display face for headings and labels. Names APK Futural ahead of the body
     * face: naming a family is not distributing it, so this package stays
     * publishable while any surface that has licensed and `@font-face`-declared
     * the file renders it. Everywhere else falls straight through to Arimo,
     * which is what a font stack is for.
     */
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
  colorRole: {
    // The frames give links no colour of their own — they take the surrounding
    // text colour and are marked by an underline. `currentColor` says exactly
    // that, and still gives tenants one variable to tint if they want links to
    // stand out.
    link: { dark: "currentColor", light: "currentColor" },
    // No warning role exists in the design system yet; these are the Tailwind
    // amber steps the library already registers, chosen to sit at the same
    // weight as `--zl-destructive` in each mode. Raised with design — see the
    // open questions on the rebuild.
    warning: { dark: "#fbbf24", light: "#d97706" },
  },
  font: {
    family: {
      sans: '"Arimo", system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
      heading:
        '"APK Futural", "Arimo", system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
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
