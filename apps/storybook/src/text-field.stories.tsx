import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { TextField } from "@zitadel/ui-react";
import { html, nothing } from "lit";
import { expect, userEvent, within } from "storybook/test";

import { renderReact } from "./react-render.js";

import "@zitadel/components/atoms";

interface TextFieldArgs {
  label: string;
  type: "text" | "email" | "password";
  placeholder: string;
  required: boolean;
  disabled: boolean;
  invalid: boolean;
  error: string;
  success: string;
  forgotPasswordHref: string;
}

/**
 * Text field atom — the Lit web component (`<zl-field>`) and its paired React
 * implementation (`<TextField>`) side by side. Both consume the same shared
 * `.zr-field` surface CSS.
 *
 * One controls-driven story per renderer: validity (`invalid`/`error`/
 * `success`), `required`, `disabled`, and the optional forgot-password link are
 * knobs — there are no per-state stories.
 */
const meta: Meta<TextFieldArgs> = {
  title: "Atoms/Text Field",
  tags: ["autodocs"],
  args: {
    label: "Email",
    type: "email",
    placeholder: "you@example.com",
    required: false,
    disabled: false,
    invalid: false,
    error: "",
    success: "",
    forgotPasswordHref: "",
  },
  argTypes: {
    label: { control: "text" },
    type: { control: "inline-radio", options: ["text", "email", "password"] },
    placeholder: { control: "text" },
    required: { control: "boolean" },
    disabled: { control: "boolean" },
    invalid: { control: "boolean" },
    error: { control: "text", description: "Inline error message (forces the invalid treatment)." },
    success: { control: "text", description: "Inline success message." },
    forgotPasswordHref: { control: "text", description: "When set, renders the forgot-password link row." },
  },
};

export default meta;
type Story = StoryObj<TextFieldArgs>;

export const Lit: Story = {
  render: ({ label, type, placeholder, required, disabled, invalid, error, success, forgotPasswordHref }) => html`
    <zl-field
      label=${label}
      type=${type}
      placeholder=${placeholder}
      ?required=${required}
      ?disabled=${disabled}
      ?invalid=${invalid}
      error=${error || nothing}
      success=${success || nothing}
      forgot-password-href=${forgotPasswordHref || nothing}
    ></zl-field>
  `,
};

// The React pair has no component-level spec, so this `play` is its sole
// behavioural test: the trailing clear button empties the input.
export const React: Story = {
  render: ({ label, type, placeholder, required, disabled, invalid, error, success, forgotPasswordHref }) =>
    renderReact(
      <TextField
        label={label}
        type={type}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        invalid={invalid}
        error={error || undefined}
        success={success || undefined}
        forgotPasswordHref={forgotPasswordHref || undefined}
      />,
    ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole<HTMLInputElement>("textbox");
    await userEvent.type(input, "hello@example.com");
    await expect(input.value).toBe("hello@example.com");
    await userEvent.click(canvas.getByRole("button", { name: "Clear" }));
    await expect(input.value).toBe("");
    // Clearing refocuses the input; blur so the resting story matches the Lit pair.
    input.blur();
  },
};
