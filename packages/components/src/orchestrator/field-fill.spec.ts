import type {
  CreateFlow201StepActionsItem,
  CreateFlow201StepFieldsItem,
} from "@zitadel/api/generated/model";
import { describe, expect, it } from "vitest";

import { type FieldFillContext, fillFields } from "./field-fill.js";

const locale: Record<string, string> = {
  "password.field.email": "Email",
  "password.field.email.placeholder": "you@acme.com",
  "password.field.email.help": "We never share it.",
  "password.field.password": "Password",
  "password.field.plan": "Plan",
  "password.field.terms": "I agree",
  "action.forgot_password": "Forgot password?",
  "error.email_invalid": "Enter a valid email.",
};

const fields = [
  {
    name: "email",
    type: "email",
    text_key: "password.field.email",
    autocomplete: "username",
    required: true,
  },
  { name: "x-auth-methods#password", type: "password", text_key: "password.field.password" },
  {
    name: "plan",
    type: "select",
    text_key: "password.field.plan",
    value: "pro",
    validation: { enum: ["free", "pro"] },
  },
  { name: "terms", type: "checkbox", text_key: "password.field.terms", value: true },
] as unknown as CreateFlow201StepFieldsItem[];

const actions = [
  { name: "recover", kind: "navigate", text_key: "action.forgot_password" },
] as unknown as CreateFlow201StepActionsItem[];

function context(overrides: Partial<FieldFillContext> = {}): FieldFillContext {
  return { fields, actions, errors: [], locale, ...overrides };
}

function render(markup: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = markup;
  return root;
}

const field = (root: ParentNode, name: string): Element =>
  [...root.querySelectorAll("[name]")].find((el) => el.getAttribute("name") === name)!;

describe("fillFields", () => {
  it("fills a name-only field from the step", () => {
    const root = render(`<zl-field name="email"></zl-field>`);
    fillFields(root, context());
    const email = field(root, "email");
    expect(email.getAttribute("label")).toBe("Email");
    expect(email.getAttribute("type")).toBe("email");
    expect(email.getAttribute("autocomplete")).toBe("username");
    expect(email.hasAttribute("required")).toBe(true);
    expect(email.getAttribute("placeholder")).toBe("you@acme.com");
    expect(email.getAttribute("data-testid")).toBe("zitadel-field-email");
    expect(email.querySelector('[slot="help"]')?.textContent).toBe("We never share it.");
    expect(email.hasAttribute("forgot-password-href")).toBe(false);
  });

  it("puts the forgot-password link on the password field and normalises its hook", () => {
    const root = render(`<zl-field name="x-auth-methods#password"></zl-field>`);
    fillFields(root, context());
    const password = field(root, "x-auth-methods#password");
    expect(password.getAttribute("data-testid")).toBe("zitadel-field-password");
    expect(password.getAttribute("forgot-password-action")).toBe("recover");
    expect(password.getAttribute("forgot-password-label")).toBe("Forgot password?");
  });

  it("fills select options and the prefilled checkbox", () => {
    const root = render(
      `<zl-select name="plan"></zl-select><zl-checkbox name="terms"></zl-checkbox>`,
    );
    fillFields(root, context());
    const plan = field(root, "plan");
    expect(JSON.parse(plan.getAttribute("options") ?? "[]")).toEqual([
      { value: "free", label: "free" },
      { value: "pro", label: "pro" },
    ]);
    expect(plan.getAttribute("value")).toBe("pro");
    expect(field(root, "terms").hasAttribute("checked")).toBe(true);
    expect(field(root, "terms").getAttribute("value")).toBe("true");
  });

  it("leaves attributes and help the template wrote alone", () => {
    const root = render(
      `<zl-field name="email" label="Work email" placeholder=""><span slot="help">Ours</span></zl-field>`,
    );
    fillFields(root, context({ errors: [{ field: "email", text_key: "error.email_invalid" }] }));
    const email = field(root, "email");
    expect(email.getAttribute("label")).toBe("Work email");
    expect(email.getAttribute("placeholder")).toBe("");
    expect(email.querySelectorAll('[slot="help"]')).toHaveLength(1);
    // Everything the template left out is still filled.
    expect(email.getAttribute("error")).toBe("Enter a valid email.");
  });

  it("lets an empty attribute switch a filled part off", () => {
    const root = render(
      `<zl-field name="x-auth-methods#password" forgot-password-href=""></zl-field>`,
    );
    fillFields(root, context());
    const password = field(root, "x-auth-methods#password");
    // The atom renders no link for an empty href; the fill must leave it empty.
    expect(password.getAttribute("forgot-password-href")).toBe("");
  });

  it("ignores atoms whose name the step does not declare", () => {
    const root = render(`<zl-field name="nickname"></zl-field>`);
    fillFields(root, context());
    expect(field(root, "nickname").getAttributeNames()).toEqual(["name"]);
  });

  it("does not bring back an error the widget cleared while the step is unchanged", () => {
    const root = render(`<zl-field name="email"></zl-field>`);
    const withError = context({ errors: [{ field: "email", text_key: "error.email_invalid" }] });
    fillFields(root, withError);
    const email = field(root, "email");
    expect(email.hasAttribute("invalid")).toBe(true);

    // The visitor types: the widget clears the error on the atom directly.
    email.removeAttribute("invalid");
    email.removeAttribute("error");
    fillFields(root, withError);
    expect(email.hasAttribute("invalid")).toBe(false);
    expect(email.hasAttribute("error")).toBe(false);

    // A new response without the error, then one with it again, does apply.
    fillFields(root, context());
    fillFields(root, withError);
    expect(email.getAttribute("error")).toBe("Enter a valid email.");
  });

  it("removes its own help when the step stops offering it", () => {
    const root = render(`<zl-field name="email"></zl-field>`);
    fillFields(root, context());
    const { "password.field.email.help": _help, ...withoutHelp } = locale;
    fillFields(root, context({ locale: withoutHelp }));
    expect(field(root, "email").querySelector('[slot="help"]')).toBeNull();
  });
});
