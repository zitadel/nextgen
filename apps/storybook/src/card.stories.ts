import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html, nothing } from "lit";

import "@zitadel/components/atoms";

interface CardArgs {
  heading: string;
  body: string;
  footer: string;
  compact: boolean;
}

/**
 * Card atom (`<zl-card>`) — the auth-card surface with header / body / footer
 * regions; `compact` tightens the inter-region gap.
 *
 * One controls-driven story: the header/body/footer text and `compact` are
 * knobs (clear a text field to drop that region).
 */
const meta: Meta<CardArgs> = {
  title: "Atoms/Card",
  tags: ["autodocs"],
  args: {
    heading: "Sign in",
    body: "Enter your email and password to continue.",
    footer: "Secured with Zitadel",
    compact: false,
  },
  argTypes: {
    heading: { control: "text" },
    body: { control: "text" },
    footer: { control: "text" },
    compact: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<CardArgs>;

export const Default: Story = {
  render: ({ heading, body, footer, compact }) => html`
    <zl-card ?compact=${compact}>
      ${heading ? html`<span slot="header">${heading}</span>` : nothing}
      <p>${body}</p>
      ${footer ? html`<span slot="footer">${footer}</span>` : nothing}
    </zl-card>
  `,
};
