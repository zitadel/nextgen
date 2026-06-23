import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { Checkbox } from "@zitadel/ui-react";
import { html, nothing } from "lit";
import { expect, userEvent, within } from "storybook/test";

import { renderReact } from "./react-render.js";

import "@zitadel/components/atoms";

interface CheckboxArgs {
  label: string;
  checked: boolean;
  disabled: boolean;
  required: boolean;
  /** Preview-only knob: paints a Figma interaction state (hover/focus/pressed). */
  previewState: "" | "hovered" | "focused" | "pressed";
}

/**
 * Checkbox atom — the Lit web component (`<zl-checkbox>`) and its paired React
 * implementation (`<Checkbox>`) shown side by side. Both consume the same
 * shared `.zr-*` surface CSS, so the two stories are the parity check.
 *
 * Each renderer is ONE controls-driven story: every state (checked / disabled /
 * required / label / interaction preview) is a knob — there are no per-state
 * stories. Clearing the `label` control falls back to an `aria-label` so the
 * unlabelled checkbox stays accessible.
 */
const meta: Meta<CheckboxArgs> = {
  title: "Atoms/Checkbox",
  tags: ["autodocs"],
  args: { label: "Label", checked: false, disabled: false, required: false, previewState: "" },
  argTypes: {
    label: { control: "text" },
    checked: { control: "boolean" },
    disabled: { control: "boolean" },
    required: { control: "boolean" },
    previewState: {
      control: "inline-radio",
      options: ["", "hovered", "focused", "pressed"],
      description: "Preview the Figma interaction states without real pointer/focus.",
    },
  },
};

export default meta;
type Story = StoryObj<CheckboxArgs>;

// No `play` here on purpose: `<zl-checkbox>`'s toggle/form/focus behaviour is
// owned by the lower component layer (zl-checkbox.spec.ts +
// zl-checkbox.browser.spec.ts), so re-clicking it here would duplicate upward.
// The story still gets addon-vitest's automatic render smoke + a11y pass.
export const Lit: Story = {
  render: ({ label, checked, disabled, required, previewState }) => html`
    <zl-checkbox
      label=${label || nothing}
      aria-label=${label ? nothing : "Accept terms"}
      ?checked=${checked}
      ?disabled=${disabled}
      ?required=${required}
      data-state=${previewState || nothing}
    ></zl-checkbox>
  `,
};

// The React pair has no component-level spec, so this `play` is its sole
// behavioural test (toggle via the label). Render smoke + a11y come for free.
export const React: Story = {
  render: ({ label, checked, disabled, required, previewState }) =>
    renderReact(
      <Checkbox
        label={label || undefined}
        defaultChecked={checked}
        disabled={disabled}
        required={required}
        previewState={previewState || undefined}
        aria-label={label ? undefined : "Accept terms"}
      />,
    ),
  play: async ({ canvasElement }) => {
    // `findByRole` waits for React to commit (mount is async, unlike Lit's
    // synchronous shadow render).
    const input = await within(canvasElement).findByRole<HTMLInputElement>("checkbox");
    const label = input.closest<HTMLElement>(".zr-checkbox");
    if (!label) throw new Error("checkbox label not found");
    await expect(input.checked).toBe(false);
    await userEvent.click(label);
    await expect(input.checked).toBe(true);
  },
};
