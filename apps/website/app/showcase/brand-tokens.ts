import type { FileLine } from "./types";

// The brand playground (brand-row.tsx): the few --zl-* custom properties an
// app sets on <zitadel-login> to brand it, as the docs' "Customize the design"
// page has it, and the base layer the atoms read under them.

export type Corners = "sharp" | "soft" | "round";
export type Headings = "sans" | "serif" | "mono";

export type BrandChoice = {
  /** The brand color, as a hex string. */
  color: string;
  corners: Corners;
  headings: Headings;
};

/** The colors to pick from, Zitadel's own orange first; any other comes from the picker. */
export const COLORS = [
  { name: "Zitadel orange", value: "#f25543" },
  { name: "Blue", value: "#2563eb" },
  { name: "Green", value: "#16a34a" },
  { name: "Purple", value: "#9333ea" },
  // The design system's own primary, as the login ships.
  { name: "Default", value: "#e5e5e5" },
] as const;

/**
 * The corner ramps, in px: md rounds the fields and the buttons, xl the card.
 * Soft is the design system's own (--zl-radius-md 0.5rem, --zl-radius-xl
 * 0.875rem).
 */
export const CORNERS: Record<Corners, { label: string; md: number; xl: number }> = {
  sharp: { label: "Sharp", md: 2, xl: 4 },
  soft: { label: "Soft", md: 8, xl: 14 },
  round: { label: "Round", md: 18, xl: 28 },
};

/**
 * The heading faces. `css` is what the app's stylesheet would say; `painted`
 * is what this page paints with, where it differs: Arimo loads through
 * next/font (layout.tsx), under a name of next/font's own.
 */
export const HEADINGS: Record<Headings, { label: string; css: string; painted?: string }> = {
  sans: {
    label: "Sans",
    css: "Arimo, system-ui, sans-serif",
    painted: "var(--font-arimo), system-ui, sans-serif",
  },
  serif: { label: "Serif", css: 'Georgia, "Times New Roman", serif' },
  mono: { label: "Mono", css: "ui-monospace, SFMono-Regular, Menlo, monospace" },
};

// Zitadel's orange with the corners and heading face the recorded session set,
// so the card shows a change before the visitor makes one.
export const DEFAULT_CHOICE: BrandChoice = {
  color: COLORS[0].value,
  corners: "sharp",
  headings: "serif",
};

const channel = (value: number) => {
  const share = value / 255;
  return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
};

/** White on a dark brand color, near-black on a light one (WCAG relative luminance). */
function foregroundFor(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const luminance =
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255);
  return luminance > 0.4 ? "#171717" : "#ffffff";
}

type Property = { name: string; css: string; painted?: string };

function brandProperties({ color, corners, headings }: BrandChoice): Property[] {
  return [
    { name: "--zl-primary", css: color },
    { name: "--zl-primary-foreground", css: foregroundFor(color) },
    { name: "--zl-ring", css: color },
    { name: "--zl-link", css: color },
    { name: "--zl-radius-md", css: `${CORNERS[corners].md}px` },
    { name: "--zl-radius-xl", css: `${CORNERS[corners].xl}px` },
    {
      name: "--zl-font-family-heading",
      css: HEADINGS[headings].css,
      painted: HEADINGS[headings].painted,
    },
  ];
}

/** The rule the choice amounts to in the app's stylesheet. */
export function brandStylesheet(choice: BrandChoice): string {
  const declarations = brandProperties(choice).map(({ name, css }) => `  ${name}: ${css};`);
  return ["zitadel-login {", ...declarations, "}"].join("\n");
}

/** The rule as the editor card's lines, every one of them added. */
export function brandLines(choice: BrandChoice): FileLine[] {
  return brandStylesheet(choice)
    .split("\n")
    .map((text) => ({ type: "added", text }));
}

/** The same properties as this page paints them. */
export function paintedProperties(choice: BrandChoice): Record<string, string> {
  return Object.fromEntries(
    brandProperties(choice).map(({ name, css, painted }) => [name, painted ?? css]),
  );
}

type TokenTree = { readonly [key: string]: string | number | TokenTree };

/**
 * Every --zl-* custom property at its default, the dark side, from the
 * package's own token objects: `cssVars` names each token as the generated
 * stylesheet does (`var(--zl-card-foreground)`), `tokens` holds its value,
 * at the same place in the same tree. An atom on its own reads them from its
 * ancestors; `<zitadel-login>` would bring them itself.
 */
export function baseProperties(tokens: TokenTree, cssVars: TokenTree): Record<string, string> {
  const properties: Record<string, string> = {};
  const walk = (values: TokenTree, names: TokenTree) => {
    for (const [key, value] of Object.entries(values)) {
      const name = names[key];
      if (typeof value === "object") {
        if (typeof name === "object") {
          walk(value, name);
        }
      } else if (typeof name === "string") {
        properties[name.slice("var(".length, -")".length)] = String(value);
      }
    }
  };
  walk(tokens, cssVars);
  // The faces as an app's login shows them: Arimo, here under next/font's
  // name. The heading token names APK Futural first, a licensed face that
  // Zitadel's own sites load and an app does not (ADR 025), so an app's
  // headings fall back to Arimo too.
  const arimo = "var(--font-arimo), system-ui, sans-serif";
  properties["--zl-font-family-sans"] = arimo;
  properties["--zl-font-family-heading"] = arimo;
  return properties;
}

/**
 * The --zl-* properties the light side changes, from the package's generated
 * stylesheet: its token objects hold the dark side only. Laid over the base
 * layer, they paint the login as `<zitadel-login theme="light">` would.
 */
export function lightProperties(tokensCss: string, selector: string): Record<string, string> {
  const start = tokensCss.indexOf(`${selector} {`);
  const block = start < 0 ? "" : tokensCss.slice(start, tokensCss.indexOf("}", start));
  return Object.fromEntries(
    [...block.matchAll(/(--zl-[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value]),
  );
}
