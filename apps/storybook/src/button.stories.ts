import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html, nothing } from "lit";

import "@zitadel/components/atoms";

interface ButtonArgs {
  label: string;
  hierarchy: "primary" | "secondary" | "outline" | "text";
  size: "medium" | "small";
  loading: boolean;
  disabled: boolean;
  block: boolean;
  /** Render a leading icon to exercise the `leading` slot. */
  leadingIcon: boolean;
  /** Stories-only knob: forces an interaction state. */
  previewState: "" | "hovered" | "focused" | "pressed";
}

/**
 * Button atom (`<zl-button>`).
 *
 * One controls-driven story: hierarchy, size, loading, disabled, block, the
 * leading icon, and the interaction preview are knobs — there are no
 * per-variant stories.
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
    previewState: "",
  },
  argTypes: {
    label: { control: "text" },
    hierarchy: { control: "inline-radio", options: ["primary", "secondary", "outline", "text"] },
    size: { control: "inline-radio", options: ["medium", "small"] },
    loading: { control: "boolean" },
    disabled: { control: "boolean" },
    block: { control: "boolean" },
    leadingIcon: {
      control: "boolean",
      description: "Render a leading icon in the `leading` slot.",
    },
    previewState: {
      control: "inline-radio",
      options: ["", "hovered", "focused", "pressed"],
      description: "Preview an interaction state without real pointer/focus.",
    },
  },
};

export default meta;
type Story = StoryObj<ButtonArgs>;

export const Default: Story = {
  render: ({ label, hierarchy, size, loading, disabled, block, leadingIcon, previewState }) => html`
    <zl-button
      label=${label}
      hierarchy=${hierarchy}
      size=${size}
      ?loading=${loading}
      ?disabled=${disabled}
      ?block=${block}
      data-state=${previewState || nothing}
    >
      ${
        leadingIcon
          ? html`<zl-icon
            slot="leading"
            name="arrow-left"
            size="16"
            decorative
          ></zl-icon>`
          : nothing
      }
    </zl-button>
  `,
};
