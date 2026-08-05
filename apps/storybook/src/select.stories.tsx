import type { Meta, StoryObj } from "@storybook/web-components-vite";
import type { ZlSelect } from "@zitadel/components";
import { Select, type SelectOption } from "@zitadel/ui-react";
import { html, nothing } from "lit";
import { expect, within } from "storybook/test";

import { assertParity } from "./parity.js";
import { renderReact } from "./react-render.js";

import "@zitadel/components/atoms";

interface SelectArgs {
  label: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  required: boolean;
  /** Inline validation message shown under the control (empty = none). */
  error: string;
  /** Preview-only knob: forces the listbox open so the menu states are visible. */
  open: boolean;
}

const OPTIONS: SelectOption[] = [
  { value: "us", label: "United States" },
  { value: "de", label: "Germany" },
  { value: "ch", label: "Switzerland" },
  { value: "at", label: "Austria", disabled: true },
];

// `options` is a complex value, so it's a property binding (`.options`), not an
// attribute. Shared by the Lit, React, and Parity stories so all three drive the
// same surface.
const litSelect = ({ label, placeholder, value, disabled, required, error, open }: SelectArgs) => html`
  <zl-select
    name="country"
    label=${label || nothing}
    aria-label=${label ? nothing : "Country"}
    placeholder=${placeholder}
    value=${value || nothing}
    .options=${OPTIONS}
    ?disabled=${disabled}
    ?required=${required}
    error=${error || nothing}
    ?open=${open}
  ></zl-select>
`;

const reactSelect = ({ label, placeholder, value, disabled, required, error, open }: SelectArgs) => (
  <Select
    name="country"
    label={label || undefined}
    aria-label={label ? undefined : "Country"}
    placeholder={placeholder}
    options={OPTIONS}
    defaultValue={value || undefined}
    defaultOpen={open}
    disabled={disabled}
    required={required}
    error={error || undefined}
  />
);

/**
 * Select atom — the Lit web component (`<zl-select>`) and its paired React
 * implementation (`<Select>`) shown side by side. Both consume the same shared
 * `.zr-select` surface CSS, so the two stories are the parity check.
 *
 * The operable control is a real native `<select>` (the accessibility +
 * automation surface); the styled trigger + popup are a pointer-only,
 * `aria-hidden` visual layer over it. Each renderer is ONE controls-driven
 * story; every state (selected value /
 * disabled / required / forced-open) is a knob — there are no per-state stories.
 * Clearing `label` falls back to an `aria-label` so the trigger stays accessible.
 */
const meta: Meta<SelectArgs> = {
  title: "Atoms/Select",
  tags: ["autodocs"],
  args: {
    label: "Country",
    placeholder: "Select a country",
    value: "",
    disabled: false,
    required: false,
    error: "",
    open: false,
  },
  argTypes: {
    label: { control: "text" },
    placeholder: { control: "text" },
    value: { control: "inline-radio", options: ["", "us", "de", "ch", "at"] },
    disabled: { control: "boolean" },
    required: { control: "boolean" },
    error: { control: "text" },
    open: {
      control: "boolean",
      description: "Preview the open menu without a real click.",
    },
  },
  decorators: [
    (story) => html`<div style="width: 20rem; min-height: 18rem;">${story()}</div>`,
  ],
};

export default meta;
type Story = StoryObj<SelectArgs>;

// No `play` here: `<zl-select>`'s open/keyboard/form/focus behaviour is owned by
// the component layer (zl-select.spec.ts + zl-select.browser.spec.ts), so
// re-driving it here would duplicate upward. The story still gets addon-vitest's
// automatic render smoke + a11y pass.
export const Lit: Story = {
  render: (args) => litSelect(args),
};

export const React: Story = {
  render: (args) => renderReact(reactSelect(args)),
};

/**
 * Cross-renderer parity gate: mounts both renderers (open, with a selection) and
 * asserts they compute identical styles for every shared `.zr-select__*`
 * selector. This is the automated version of the side-by-side eyeball — it fails
 * the run on box-model / colour / type drift instead of leaving it to be spotted
 * in a screenshot. a11y is off here because two live comboboxes on one page is a
 * test rig, not a UX surface (the Lit/React stories carry the a11y gate).
 */
export const Parity: Story = {
  args: { open: true, value: "de", error: "Please select a country." },
  parameters: { a11y: { test: "off" }, chromatic: { disableSnapshot: true } },
  decorators: [(story) => html`<div style="display: flex; gap: 2rem;">${story()}</div>`],
  render: (args) => html`
    <div style="width: 20rem;">${litSelect(args)}</div>
    <div style="width: 20rem;" data-renderer="react">${renderReact(reactSelect(args))}</div>
  `,
  play: async ({ canvasElement }) => {
    const litEl = canvasElement.querySelector<ZlSelect>("zl-select");
    if (!litEl?.shadowRoot) throw new Error("Lit <zl-select> did not render");
    await litEl.updateComplete;

    const reactRoot = canvasElement.querySelector<HTMLElement>('[data-renderer="react"]');
    if (!reactRoot) throw new Error("React container missing");
    // React mounts asynchronously; wait for its combobox before measuring.
    await within(reactRoot).findByRole("combobox");

    assertParity(litEl.shadowRoot, reactRoot, [
      ".zr-select__trigger",
      ".zr-select__value",
      ".zr-select__listbox",
      ".zr-select__option",
      ".zr-select__option[data-selected]",
      ".zr-select__error",
    ]);

    // Guard the box-model divergence this gate was added to catch (40px rows).
    const optionHeight = (root: ParentNode) => {
      const option = root.querySelector(".zr-select__option");
      if (!option) throw new Error("no option to measure");
      return option.getBoundingClientRect().height;
    };
    await expect(optionHeight(reactRoot)).toBe(optionHeight(litEl.shadowRoot));
  },
};
