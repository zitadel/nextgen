import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html, nothing } from "lit";

import "@zitadel/components/atoms";

interface AlertArgs {
  severity: "error" | "success" | "warning" | "info";
  heading: string;
  message: string;
  dismissible: boolean;
}

/**
 * Alert atom (`<zl-alert>`). Severity drives the icon, colour, and aria
 * semantics (`role="alert"` for errors, `role="status"` otherwise).
 *
 * One controls-driven story: severity, heading, message, and dismissibility
 * are knobs.
 */
const meta: Meta<AlertArgs> = {
  title: "Atoms/Alert",
  tags: ["autodocs"],
  args: {
    severity: "error",
    heading: "Something went wrong",
    message: "Wrong email or password. Please try again.",
    dismissible: false,
  },
  argTypes: {
    severity: { control: "inline-radio", options: ["error", "success", "warning", "info"] },
    heading: { control: "text" },
    message: { control: "text" },
    dismissible: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<AlertArgs>;

export const Default: Story = {
  render: ({ severity, heading, message, dismissible }) => html`
    <zl-alert severity=${severity} heading=${heading || nothing} ?dismissible=${dismissible}>
      ${message}
    </zl-alert>
  `,
};
