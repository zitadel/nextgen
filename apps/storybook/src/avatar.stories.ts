import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html } from "lit";

import "@zitadel/components/atoms";

interface AvatarArgs {
  seed: string;
}

/**
 * Avatar atom (`<zl-avatar>`): the gradient generated from what a visitor
 * typed, the same one the console shows for that identifier. Its direction
 * wanders unless reduced motion is asked for.
 *
 * One controls-driven story: the seed is the knob.
 */
const meta: Meta<AvatarArgs> = {
  title: "Atoms/Avatar",
  tags: ["autodocs"],
  args: { seed: "maya@example.com" },
  argTypes: {
    seed: {
      control: "text",
      description: "The identifier as typed; case and surrounding spaces do not matter.",
    },
  },
};

export default meta;
type Story = StoryObj<AvatarArgs>;

export const Default: Story = {
  render: ({ seed }) => html`<zl-avatar seed=${seed}></zl-avatar>`,
};
