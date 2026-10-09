import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html, nothing } from "lit";

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
  value: string;
  help: string;
  trailingIcon: boolean;
  /** Stories-only knob: forces an interaction state. */
  previewState: "" | "hovered" | "focused";
}

/**
 * Text field atom (`<zl-field>`).
 *
 * One controls-driven story: validity (`invalid`/`error`/`success`),
 * `required`, `disabled`, the value, help text, trailing icon, forgot-password
 * link, and the interaction preview are knobs — there are no per-state stories.
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
    value: "",
    help: "",
    trailingIcon: true,
    previewState: "",
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
    forgotPasswordHref: {
      control: "text",
      description: "When set, renders the forgot-password link row.",
    },
    value: { control: "text" },
    help: { control: "text", description: "Help text in the `help` slot." },
    trailingIcon: { control: "boolean", description: "Show the default trailing icon." },
    previewState: {
      control: "inline-radio",
      options: ["", "hovered", "focused"],
      description: "Preview an interaction state without real pointer/focus.",
    },
  },
};

export default meta;
type Story = StoryObj<TextFieldArgs>;

export const Default: Story = {
  render: ({
    label,
    type,
    placeholder,
    required,
    disabled,
    invalid,
    error,
    success,
    forgotPasswordHref,
    value,
    help,
    trailingIcon,
    previewState,
  }) => html`
    <zl-field
      label=${label}
      type=${type}
      placeholder=${placeholder}
      .value=${value}
      .trailingIcon=${trailingIcon}
      ?required=${required}
      ?disabled=${disabled}
      ?invalid=${invalid}
      error=${error || nothing}
      success=${success || nothing}
      forgot-password-href=${forgotPasswordHref || nothing}
      data-state=${previewState || nothing}
    >
      ${help ? html`<span slot="help">${help}</span>` : nothing}
    </zl-field>
  `,
};
