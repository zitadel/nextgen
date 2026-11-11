import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html, nothing } from "lit";

import "@zitadel/components/atoms";

interface AccountArgs {
  identifier: string;
  avatar: boolean;
  action: boolean;
  label: string;
}

/**
 * Account atom (`<zl-account>`): the account a step signs in to, as a
 * full-width chip. The template decides per step whether it shows the avatar
 * and whether the chip runs an action (the step's `back`).
 *
 * One controls-driven story: the four states are the `avatar` and `action`
 * knobs.
 */
const meta: Meta<AccountArgs> = {
  title: "Atoms/Account",
  tags: ["autodocs"],
  args: {
    identifier: "maya@example.com",
    avatar: true,
    action: true,
    label: "Use another account",
  },
  argTypes: {
    identifier: { control: "text", description: "What the visitor typed." },
    avatar: {
      control: "boolean",
      description: "Show the generated avatar; off where no account exists yet (sign-up).",
    },
    action: {
      control: "boolean",
      description: "Run the step's `back` from the whole chip; off for a static chip.",
    },
    label: { control: "text", description: "What the action does, for its accessible name." },
  },
  // The chip spans its container; give it a card's content width.
  decorators: [(story) => html`<div style="width: 336px">${story()}</div>`],
};

export default meta;
type Story = StoryObj<AccountArgs>;

export const Default: Story = {
  render: ({ identifier, avatar, action, label }) => html`
    <zl-account
      identifier=${identifier}
      action=${action ? "back" : nothing}
      label=${action ? label : nothing}
      ?avatar=${avatar}
    ></zl-account>
  `,
};
