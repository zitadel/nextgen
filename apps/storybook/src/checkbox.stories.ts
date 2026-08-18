import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html, nothing } from "lit";

import "@zitadel/components/atoms";

interface CheckboxArgs {
  label: string;
  checked: boolean;
  disabled: boolean;
  required: boolean;
  /** Inline validation message shown under the row (empty = none). */
  error: string;
  /** Preview-only knob: paints a Figma interaction state (hover/focus/pressed). */
  previewState: "" | "hovered" | "focused" | "pressed";
}

/**
 * Checkbox atom (`<zl-checkbox>`).
 *
 * ONE controls-driven story: every state (checked / disabled / required /
 * label / interaction preview) is a knob — there are no per-state stories.
 * Clearing the `label` control falls back to an `aria-label` so the
 * unlabelled checkbox stays accessible.
 */
const meta: Meta<CheckboxArgs> = {
  title: "Atoms/Checkbox",
  tags: ["autodocs"],
  args: { label: "Label", checked: false, disabled: false, required: false, error: "", previewState: "" },
  argTypes: {
    label: { control: "text" },
    checked: { control: "boolean" },
    disabled: { control: "boolean" },
    required: { control: "boolean" },
    error: { control: "text" },
    previewState: {
      control: "inline-radio",
      options: ["", "hovered", "focused", "pressed"],
      description: "Preview the Figma interaction states without real pointer/focus.",
    },
  },
};

export default meta;
type Story = StoryObj<CheckboxArgs>;

const litCheckbox = ({ label, checked, disabled, required, error, previewState }: CheckboxArgs) => html`
  <zl-checkbox
    label=${label || nothing}
    aria-label=${label ? nothing : "Accept terms"}
    ?checked=${checked}
    ?disabled=${disabled}
    ?required=${required}
    error=${error || nothing}
    data-state=${previewState || nothing}
  ></zl-checkbox>
`;

// No `play` here on purpose: `<zl-checkbox>`'s toggle/form/focus behaviour is
// owned by the lower component layer (zl-checkbox.spec.ts +
// zl-checkbox.browser.spec.ts), so re-clicking it here would duplicate upward.
// The story still gets addon-vitest's automatic render smoke + a11y pass.
export const Default: Story = {
  render: (args) => litCheckbox(args),
};
