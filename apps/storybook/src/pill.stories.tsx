import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { Pill } from "@zitadel/ui-react";
import { html, nothing } from "lit";

import { renderReact } from "./react-render.js";

import "@zitadel/components/atoms";

interface PillArgs {
  label: string;
  tone: "neutral" | "pink" | "purple" | "orange" | "success";
  href: string;
}

/**
 * Pill atom — the Lit web component (`<zl-pill>`) and its paired React
 * implementation (`<Pill>`) side by side. Renders an anchor when `href` is set
 * (the "Secured with Zitadel" attribution chip) and a span otherwise.
 *
 * One controls-driven story per renderer: tone, label, and href are knobs.
 */
const meta: Meta<PillArgs> = {
  title: "Atoms/Pill",
  tags: ["autodocs"],
  args: { label: "Secured with Zitadel", tone: "neutral", href: "" },
  argTypes: {
    label: { control: "text" },
    tone: { control: "select", options: ["neutral", "pink", "purple", "orange", "success"] },
    href: { control: "text", description: "When set, the pill renders as a link." },
  },
};

export default meta;
type Story = StoryObj<PillArgs>;

export const Lit: Story = {
  render: ({ label, tone, href }) => html`
    <zl-pill tone=${tone} href=${href || nothing}>${label}</zl-pill>
  `,
};

export const React: Story = {
  render: ({ label, tone, href }) =>
    renderReact(
      <Pill tone={tone} href={href || undefined}>
        {label}
      </Pill>,
    ),
};
