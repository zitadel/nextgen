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
  gradient: GradientTokens;
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
   * Separate roles rather than the neutral ones so every provider button
   * keeps one neutral look whatever the tenant's palette: a vendor's mark on a
   * brand-coloured fill (the Google "G" on pink) reads as broken, and a stack
   * of providers should look like one group. `PALETTE_MAP` deliberately never
   * names these (`branding-to-tokens.ts`), which is what keeps branding out;
   * a host page can still set them in its own CSS.
   *
   * The values are the design's outline button, so the shipped login page
   * matches Figma with no tenant input at all. They are not Google's exact
   * button themes — like Auth0 and Clerk, one neutral style serves every
   * provider — and moving to those is a change of values here, nothing else.
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

/** One stop of a composed gradient: which exported `gradient/*` colour, and where. */
export interface GradientStop {
  /** Kebab-case name of the exported colour, e.g. `red-start`. */
  color: string;
  /**
   * Which mode's value to bake in. A Figma gradient style has fixed stops, so
   * a stop that reads a themed colour must say which side it was drawn with.
   */
  mode: "dark" | "light";
  /** Stop position, e.g. `17.263%`. */
  at: string;
}

/**
 * Gradients composed from the exported `gradient/*` colours. Figma publishes
 * the colours as variables but keeps each gradient as a style, which the sync
 * cannot read, so the angle and stop positions are recorded here until the
 * design system publishes them as variables. Emitted as one
 * `--zl-gradient-<name>` `linear-gradient()` value, the same in both modes,
 * as the style is.
 */
export interface GradientTokens {
  [name: string]: { angle: string; stops: readonly GradientStop[] };
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
    // shadcn's outline button as the Figma frame draws it: the page surface
    // inside the `input` border, label in the page foreground; in dark, the
    // fill is `input` at 30%. Literal rather than a reference to `background`
    // / `input` / `foreground`: a typed token value must resolve on its own,
    // which the snapshot spec enforces — and a reference would let a tenant's
    // palette back in through those roles.
    provider: { dark: "#ffffff0b", light: "#fafafa" },
    "provider-border": { dark: "#ffffff26", light: "#e5e5e5" },
    "provider-foreground": { dark: "#fafafa", light: "#0a0a0a" },
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
  gradient: {
    // The `Gradient/Red` style: red/start to base/end, with base/end at its
    // dark value on both sides.
    red: {
      angle: "232.14deg",
      stops: [
        { color: "red-start", mode: "dark", at: "17.263%" },
        { color: "base-end", mode: "dark", at: "74.94%" },
      ],
    },
  },
};
