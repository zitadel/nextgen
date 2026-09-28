import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html, nothing } from "lit";

import "@zitadel/components/atoms";

interface PillArgs {
  label: string;
  tone: "neutral" | "outline" | "success" | "error";
  href: string;
}

/**
 * Pill atom (`<zl-pill>`). Renders an anchor when `href` is set (the
 * "Secured with Zitadel" attribution chip) and a span otherwise.
 *
 * One controls-driven story: tone, label, and href are knobs.
 */
const meta: Meta<PillArgs> = {
  title: "Atoms/Pill",
  tags: ["autodocs"],
  args: { label: "Secured with Zitadel", tone: "neutral", href: "" },
  argTypes: {
    label: { control: "text" },
    tone: { control: "select", options: ["neutral", "outline", "success", "error"] },
    href: { control: "text", description: "When set, the pill renders as a link." },
  },
};

export default meta;
type Story = StoryObj<PillArgs>;

export const Default: Story = {
  render: ({ label, tone, href }) => html`
    <zl-pill tone=${tone} href=${href || nothing}>${label}</zl-pill>
  `,
};
