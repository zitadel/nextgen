import type { Meta, StoryObj } from "@storybook/web-components-vite";
import type { IconName, IconSize, IconTone } from "@zitadel/components";
import { html, nothing } from "lit";

import "@zitadel/components/atoms";

const ICON_NAMES: IconName[] = [
  "plus",
  "arrow-right",
  "arrow-left",
  "spinner",
  "check",
  "cross",
  "warning",
  "alert-circle",
  "info",
  "passkey",
  "user",
  "eye",
  "eye-off",
];

interface IconArgs {
  name: IconName;
  size: IconSize;
  tone: IconTone;
  spin: boolean;
  decorative: boolean;
  label: string;
}

/**
 * Icon atom (`<zl-icon>`) — the curated Lucide-backed glyph set. Decorative
 * icons are `aria-hidden`; otherwise they expose an `aria-label` (a default per
 * glyph, or the `label` override).
 *
 * One controls-driven story: glyph name, size, tone, spin, decorative, and
 * label are knobs.
 */
const meta: Meta<IconArgs> = {
  title: "Atoms/Icon",
  tags: ["autodocs"],
  args: { name: "user", size: "24", tone: "default", spin: false, decorative: false, label: "" },
  argTypes: {
    name: { control: "select", options: ICON_NAMES },
    size: { control: "inline-radio", options: ["16", "24"] },
    tone: { control: "inline-radio", options: ["default", "error", "success", "disabled"] },
    spin: { control: "boolean" },
    decorative: { control: "boolean", description: "Force aria-hidden (use next to a visible label)." },
    label: { control: "text", description: "Accessible name override; falls back to the glyph default." },
  },
};

export default meta;
type Story = StoryObj<IconArgs>;

export const Default: Story = {
  render: ({ name, size, tone, spin, decorative, label }) => html`
    <zl-icon
      name=${name}
      size=${size}
      tone=${tone}
      ?spin=${spin}
      ?decorative=${decorative}
      label=${label || nothing}
    ></zl-icon>
  `,
};
