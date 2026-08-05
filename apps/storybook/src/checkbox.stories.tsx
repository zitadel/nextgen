import type { Meta, StoryObj } from "@storybook/web-components-vite";
import type { ZlCheckbox } from "@zitadel/components";
import { Checkbox } from "@zitadel/ui-react";
import { html, nothing } from "lit";
import { expect, userEvent, within } from "storybook/test";

import { assertParity } from "./parity.js";
import { renderReact } from "./react-render.js";

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

// Shared render builders so the Lit, React, and Parity stories all drive the
// same surface (see apps/storybook/AGENTS.md "Mirror pairs in one file").
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

const reactCheckbox = ({ label, checked, disabled, required, error, previewState }: CheckboxArgs) => (
  <Checkbox
    label={label || undefined}
    defaultChecked={checked}
    disabled={disabled}
    required={required}
    error={error || undefined}
    previewState={previewState || undefined}
    aria-label={label ? undefined : "Accept terms"}
  />
);

// No `play` here on purpose: `<zl-checkbox>`'s toggle/form/focus behaviour is
// owned by the lower component layer (zl-checkbox.spec.ts +
// zl-checkbox.browser.spec.ts), so re-clicking it here would duplicate upward.
// The story still gets addon-vitest's automatic render smoke + a11y pass.
export const Lit: Story = {
  render: (args) => litCheckbox(args),
};

// The React pair has no component-level spec, so this `play` is its sole
// behavioural test (toggle via the label). Render smoke + a11y come for free.
export const React: Story = {
  render: (args) => renderReact(reactCheckbox(args)),
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

/**
 * Cross-renderer parity gate: mounts both renderers (checked, with a label) and
 * asserts they compute identical styles for every shared `.zr-checkbox*`
 * selector. This is the automated version of the side-by-side eyeball — it fails
 * the run on box-model / colour / type drift (the `box-sizing` and inherited
 * text/colour gotchas in packages/shared-component-styles/AGENTS.md) instead of
 * leaving it to be spotted in a screenshot. a11y is off here because two live
 * checkboxes on one page is a test rig (the Lit/React stories carry the a11y gate).
 */
export const Parity: Story = {
  args: { checked: true, error: "You must accept the terms." },
  parameters: { a11y: { test: "off" }, chromatic: { disableSnapshot: true } },
  decorators: [(story) => html`<div style="display: flex; gap: 2rem;">${story()}</div>`],
  render: (args) => html`
    <div>${litCheckbox(args)}</div>
    <div data-renderer="react">${renderReact(reactCheckbox(args))}</div>
  `,
  play: async ({ canvasElement }) => {
    const litEl = canvasElement.querySelector<ZlCheckbox>("zl-checkbox");
    if (!litEl?.shadowRoot) throw new Error("Lit <zl-checkbox> did not render");
    await litEl.updateComplete;

    const reactRoot = canvasElement.querySelector<HTMLElement>('[data-renderer="react"]');
    if (!reactRoot) throw new Error("React container missing");
    // React mounts asynchronously; wait for its checkbox before measuring.
    await within(reactRoot).findByRole("checkbox");

    // Compare the inner shared `.zr-checkbox__*` surfaces, not the `.zr-checkbox`
    // root: Lit's `:host { display: inline-flex }` makes the root a flex item,
    // which blockifies its `display` to `flex`, while React's root (child of a
    // plain div) stays `inline-flex`. That divergence is the host model, not a
    // surface-CSS drift — the inner box/face/label are flex items in both.
    assertParity(litEl.shadowRoot, reactRoot, [
      ".zr-checkbox__box",
      ".zr-checkbox__face",
      ".zr-checkbox__label",
      ".zr-checkbox__error",
    ]);
  },
};
