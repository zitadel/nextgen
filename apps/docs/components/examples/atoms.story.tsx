import { defineStory } from "@/lib/story";

import { AlertExample, ButtonExample, CheckboxExample, FieldExample, PillExample } from "./atoms";

export const button = defineStory({
  displayName: "<zl-button>",
  Component: ButtonExample,
  args: {
    initial: {
      hierarchy: "primary",
      size: "medium",
      label: "Continue",
      loading: false,
      disabled: false,
      block: false,
    },
  },
});

export const field = defineStory({
  displayName: "<zl-field>",
  Component: FieldExample,
  args: {
    initial: {
      label: "Email",
      type: "email",
      placeholder: "you@example.com",
      error: "",
      success: "",
      required: true,
      disabled: false,
    },
  },
});

export const alert = defineStory({
  displayName: "<zl-alert>",
  Component: AlertExample,
  args: {
    initial: {
      severity: "error",
      heading: "Wrong email or password",
      message: "Check both, then try again.",
      dismissible: false,
    },
  },
});

export const checkbox = defineStory({
  displayName: "<zl-checkbox>",
  Component: CheckboxExample,
  args: {
    initial: {
      label: "I accept the terms",
      checked: false,
      required: true,
      error: "",
      disabled: false,
    },
  },
});

export const pill = defineStory({
  displayName: "<zl-pill>",
  Component: PillExample,
  args: { initial: { tone: "success", text: "Signed in" } },
});
