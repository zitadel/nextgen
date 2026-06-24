import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { Icon, type IconName, type IconSize, type IconTone } from "@zitadel/ui-react";
import { html, nothing } from "lit";

import { renderReact } from "./react-render.js";

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
 * Icon atom — the Lit web component (`<zl-icon>`) and its paired React
 * implementation (`<Icon>`) side by side. Both render the same curated
 * Lucide-backed glyph set. Decorative icons are `aria-hidden`; otherwise they
 * expose an `aria-label` (a default per glyph, or the `label` override).
 *
 * One controls-driven story per renderer: glyph name, size, tone, spin,
 * decorative, and label are knobs.
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

export const Lit: Story = {
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

export const React: Story = {
  render: ({ name, size, tone, spin, decorative, label }) =>
    renderReact(
      <Icon name={name} size={size} tone={tone} spin={spin} decorative={decorative} label={label || undefined} />,
    ),
};
