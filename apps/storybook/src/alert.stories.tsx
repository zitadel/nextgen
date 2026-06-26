import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { Alert } from "@zitadel/ui-react";
import { html, nothing } from "lit";

import { renderReact } from "./react-render.js";

import "@zitadel/components/atoms";

interface AlertArgs {
  severity: "error" | "success" | "warning" | "info";
  heading: string;
  message: string;
  dismissible: boolean;
}

/**
 * Alert atom — the Lit web component (`<zl-alert>`) and its paired React
 * implementation (`<Alert>`) side by side. Severity drives the icon, colour,
 * and aria semantics (`role="alert"` for errors, `role="status"` otherwise).
 *
 * One controls-driven story per renderer: severity, heading, message, and
 * dismissibility are knobs.
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

export const Lit: Story = {
  render: ({ severity, heading, message, dismissible }) => html`
    <zl-alert severity=${severity} heading=${heading || nothing} ?dismissible=${dismissible}>
      ${message}
    </zl-alert>
  `,
};

export const React: Story = {
  render: ({ severity, heading, message, dismissible }) =>
    renderReact(
      <Alert severity={severity} heading={heading || undefined} dismissible={dismissible}>
        {message}
      </Alert>,
    ),
};
