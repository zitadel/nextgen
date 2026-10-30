// The looks the montage cuts between: a theme of the design system and the
// few --zl-* properties an app sets on <zitadel-login> to brand it. The
// properties follow the website's brand playground
// (apps/website/app/showcase/brand-tokens.ts): a brand color, a corner ramp
// and a heading face.

export type Corners = "sharp" | "soft" | "round";
export type Headings = "sans" | "serif" | "mono";

export type Brand = {
  theme: "dark" | "light";
  /** The brand color as a hex string; without one, the design system's own primary. */
  color?: string;
  corners: Corners;
  headings: Headings;
};

/** The website's brand colors, Zitadel's orange first. */
export const COLORS = {
  orange: "#f25543",
  blue: "#2563eb",
  green: "#16a34a",
  purple: "#9333ea",
} as const;

/** The corner ramps in px: md rounds the fields and the buttons, xl the card. */
const CORNERS: Record<Corners, { md: number; xl: number }> = {
  sharp: { md: 2, xl: 4 },
  soft: { md: 8, xl: 14 },
  round: { md: 18, xl: 28 },
};

const HEADINGS: Record<Headings, string> = {
  sans: "Arimo, system-ui, sans-serif",
  serif: 'Georgia, "Times New Roman", serif',
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
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

/** The --zl-* properties a brand sets over its theme. */
export function brandProperties({ color, corners, headings }: Brand): Record<string, string> {
  return {
    ...(color && {
      "--zl-primary": color,
      "--zl-primary-foreground": foregroundFor(color),
      "--zl-ring": color,
      "--zl-link": color,
    }),
    "--zl-radius-md": `${CORNERS[corners].md}px`,
    "--zl-radius-xl": `${CORNERS[corners].xl}px`,
    "--zl-font-family-heading": HEADINGS[headings],
  };
}
