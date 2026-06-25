import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { Button, Icon } from "@zitadel/ui-react";
import { html, nothing } from "lit";

import { renderReact } from "./react-render.js";

import "@zitadel/components/atoms";

interface ButtonArgs {
  label: string;
  hierarchy: "primary" | "secondary" | "text";
  size: "medium" | "small";
  loading: boolean;
  disabled: boolean;
  block: boolean;
  /** Render a leading icon to exercise the `leading` slot / prop parity. */
  leadingIcon: boolean;
}

/**
 * Button atom — the Lit web component (`<zl-button>`) and its paired React
 * implementation (`<Button>`) shown side by side. Both consume the same shared
 * `.zr-btn` surface CSS, so the two stories are the parity check.
 *
 * One controls-driven story per renderer: hierarchy, size, loading, disabled,
 * block, and the leading icon are knobs — there are no per-variant stories.
 */
const meta: Meta<ButtonArgs> = {
  title: "Atoms/Button",
  tags: ["autodocs"],
  args: {
    label: "Continue",
    hierarchy: "primary",
    size: "medium",
    loading: false,
    disabled: false,
    block: false,
    leadingIcon: false,
  },
  argTypes: {
    label: { control: "text" },
    hierarchy: { control: "inline-radio", options: ["primary", "secondary", "text"] },
    size: { control: "inline-radio", options: ["medium", "small"] },
    loading: { control: "boolean" },
    disabled: { control: "boolean" },
    block: { control: "boolean" },
    leadingIcon: { control: "boolean", description: "Render a leading icon (slot / prop parity)." },
  },
};

export default meta;
type Story = StoryObj<ButtonArgs>;

export const Lit: Story = {
  render: ({ label, hierarchy, size, loading, disabled, block, leadingIcon }) => html`
    <zl-button
      label=${label}
      hierarchy=${hierarchy}
      size=${size}
      ?loading=${loading}
      ?disabled=${disabled}
      ?block=${block}
    >
      ${leadingIcon
        ? html`<zl-icon
            slot="leading"
            name="arrow-left"
            size=${size === "small" ? "16" : "24"}
            decorative
          ></zl-icon>`
        : nothing}
    </zl-button>
  `,
};

export const React: Story = {
  render: ({ label, hierarchy, size, loading, disabled, block, leadingIcon }) =>
    renderReact(
      <Button
        label={label}
        hierarchy={hierarchy}
        size={size}
        loading={loading}
        disabled={disabled}
        block={block}
        leading={
          leadingIcon ? <Icon name="arrow-left" size={size === "small" ? "16" : "24"} decorative /> : undefined
        }
      />,
    ),
};
