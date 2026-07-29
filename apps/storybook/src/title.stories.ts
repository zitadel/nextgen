import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html, nothing } from "lit";

import "@zitadel/components/atoms";

interface TitleArgs {
  text: string;
  hasBack: boolean;
  backLabel: string;
}

/**
 * Title atom — the card heading, optionally carrying the step's back
 * affordance (ADR 022). With `back-action` set, hovering the title (or
 * tabbing to the control) slides the heading right and reveals a back
 * chevron; clicking it dispatches `zl-submit` with the action name, which
 * the orchestrator submits like any other action.
 *
 * Lit-only: `<zl-title>` has no React pair yet (not in pairs.json).
 *
 * In the real login card the host class `.zl-card-title` (orchestrator
 * chrome CSS) provides the heading typography; the wrapper style here
 * stands in for it.
 */
const meta: Meta<TitleArgs> = {
  title: "Atoms/Title",
  tags: ["autodocs"],
  args: { text: "Create a password", hasBack: true, backLabel: "Back" },
  argTypes: {
    text: { control: "text" },
    hasBack: {
      control: "boolean",
      description: "Whether the step carries a kind: \"back\" action.",
    },
    backLabel: { control: "text", description: "Localized label (the action's text_key)." },
  },
};

export default meta;
type Story = StoryObj<TitleArgs>;

export const Lit: Story = {
  render: ({ text, hasBack, backLabel }) => html`
    <div
      style="font-family: ui-sans-serif, system-ui, sans-serif; font-size: 2rem; font-weight: 700; line-height: 2.5rem; letter-spacing: -0.02em;"
    >
      <zl-title
        back-action=${hasBack ? "back" : nothing}
        back-label=${hasBack ? backLabel : nothing}
        @zl-submit=${(event: CustomEvent<{ action: string | null }>) =>
          console.log("[storybook] zl-submit", event.detail)}
        >${text}</zl-title
      >
    </div>
  `,
};
