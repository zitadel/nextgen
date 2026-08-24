import type { Meta, StoryObj } from "@storybook/web-components-vite";
import type { ZlSelectOption } from "@zitadel/components";
import { html, nothing } from "lit";

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

const OPTIONS: ZlSelectOption[] = [
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

/**
 * Select atom (`<zl-select>`).
 *
 * The operable control is a real native `<select>` (the accessibility +
 * automation surface); the styled trigger + popup are a pointer-only,
 * `aria-hidden` visual layer over it. ONE controls-driven story; every state
 * (selected value / disabled / required / forced-open) is a knob — there are no
 * per-state stories. Clearing `label` falls back to an `aria-label` so the
 * trigger stays accessible.
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
export const Default: Story = {
  render: (args) => litSelect(args),
};
