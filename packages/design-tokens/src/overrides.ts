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
  container: ContainerTokens;
}

/**
 * Roles the design system needs but shadcn does not define. Each is a
 * `{ dark, light }` pair so it flips with the theme like every other colour.
 */
export interface ColorRoleTokens {
  link: { dark: string; light: string };
  warning: { dark: string; light: string };
  /**
   * The identity-provider button's surface, border and label.
   *
   * Separate roles rather than the neutral ones because a vendor's mark comes
   * with rules about what may sit behind it: Google permits only its light,
   * dark and neutral themes, so the button cannot be repainted from a tenant's
   * palette the way every other surface is. `PALETTE_MAP` deliberately never
   * names these (`branding-to-tokens.ts`), which is what keeps branding out;
   * a host page that has cleared the vendor rules itself can still set them in
   * its own CSS.
   *
   * The values are the design's outline button, so the shipped login page
   * matches Figma with no tenant input at all.
   */
  provider: { dark: string; light: string };
  // Kebab-cased because the build emits each key verbatim as `--zl-<key>`.
  "provider-border": { dark: string; light: string };
  "provider-foreground": { dark: string; light: string };
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

/**
 * Container roles whose width is not a step on Figma's `container/*` scale.
 * Roles that are a step (`auth-card`, `page`) are mapped in `scripts/build.ts`,
 * which rejects an entry here that names one of those roles or restates a
 * width the scale has. Keys are kebab-case role names.
 */
export interface ContainerTokens {
  /** Column the console's settings screens render in. */
  settings: string;
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
    // shadcn's outline button: the page surface in light mode, and its
    // `input` fill at 30% in dark, which is what the Figma frame draws.
    // Literal rather than a reference to `input` / `foreground`: a typed token
    // value must resolve on its own, which the snapshot spec enforces. Dark is
    // the page's own faint fill, light the page surface.
    provider: { dark: "#ffffff0b", light: "#FFFFFF" },
    // Google's own neutral border for the light theme, so the mark sits in a
    // frame its guidelines allow rather than one merely close to it.
    "provider-border": { dark: "#ffffff26", light: "#747775" },
    // Light is Google's own near-black, not the page's, so the label reads as
    // part of their button.
    "provider-foreground": { dark: "#fafafa", light: "#1F1F1F" },
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
  container: {
    // 704px. The settings frames draw this column and the scale has no step
    // for it (`2xl` is 672, `3xl` is 768).
    settings: "44rem",
  },
};
