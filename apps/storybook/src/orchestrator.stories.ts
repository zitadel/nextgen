import type { StoryObj } from "@storybook/web-components-vite";
import { PASSWORD_FIELD } from "@zitadel/api-mock";
import { html } from "lit";

import { mswLoader } from "msw-storybook-addon";

import {
  fill,
  mock,
  orchestratorArgTypes,
  orchestratorBeforeEach,
  orchestratorDefaultArgs,
  orchestratorRender,
  submit,
  waitFor,
  type OrchestratorArgs,
} from "./orchestrator-shared.js";

// Written out rather than spread from the shared base: Storybook reads a CSF
// default export statically, so a spread of an imported object silently loses
// everything but `title` -- no `msw` handlers and, worse, no `beforeEach`, so
// the branding overlay never ran and the `branding` knob did nothing on a cold
// load. It only looked like it worked when another group had already set the
// overlay as module state. The values still come from one place.
export default {
  title: "Orchestrator/Login",
  tags: ["no-test"],
  loaders: [mswLoader],
  parameters: {
    layout: "fullscreen",
    msw: { handlers: mock.handlers },
  },
  args: orchestratorDefaultArgs,
  argTypes: orchestratorArgTypes,
  beforeEach: orchestratorBeforeEach,
  render: orchestratorRender,
};
type Story = StoryObj<OrchestratorArgs>;


/**
 * Sign-in, first step: the identifier collects the email only. Submitting
 * advances to the password step — the split shape the real default flow
 * defines (`packages/config/defaults/default-login.json`).
 */
export const SignIn: Story = {};

/**
 * The widget default: no `variant` means content-sized and transparent —
 * the embedding page owns layout, background, and typography. Rendered
 * here inside a constrained light-page card, with `theme="light"` pinning
 * the colour mode the way an app with a fixed light surface would (the
 * unset default follows the visitor's `prefers-color-scheme`).
 */
export const WidgetEmbed: Story = {
  parameters: { layout: "padded" },
  render: () => html`
    <div
      style="max-width: 420px; margin: 2rem auto; padding: 1.5rem; border: 1px solid #d7d7e0; border-radius: 12px; background: #ffffff;"
    >
      <p style="margin: 0 0 1rem; font-family: sans-serif; color: #333;">
        Your app's own page content around the login widget:
      </p>
      <zitadel-login theme="light"></zitadel-login>
    </div>
  `,
};

/** Sign-up step: a different field set (email, given name, family name, DOB). */
export const SignUp: Story = { args: { purpose: "register" } };

/** Same flow, split-layout tenant branding. */
export const SplitBranding: Story = { args: { branding: "split" } };

/**
 * The second step of an ordinary sign-in, where the credential is asked for.
 * The identifier collects the email on its own, so this step is only ever
 * reached by submitting one — the story does that rather than faking a step,
 * which keeps the mock's flow the same one a visitor drives.
 */
export const PasswordStep: Story = {
  play: async ({ canvasElement }) => {
    await fill(canvasElement, "email", "ada@example.com");
    await submit(canvasElement);
    await waitFor(() =>
      canvasElement
        .querySelector("zitadel-login")
        ?.shadowRoot?.querySelector(`zl-field[name="${PASSWORD_FIELD}"]`),
    );
  },
};

/**
 * Sign-up, second step: set a password — the sibling of `PasswordStep` on the
 * register path. Reached by completing the sign-up details, the way a visitor
 * does, rather than faking the step.
 */
export const RegisterPasswordStep: Story = {
  args: { purpose: "register" },
  play: async ({ canvasElement }) => {
    await fill(canvasElement, "email", "ada@example.com");
    await fill(canvasElement, "given_name", "Ada");
    await fill(canvasElement, "family_name", "Lovelace");
    await submit(canvasElement);
    // register-password collapses the sign-up fields to a single password
    // field (whose name is the schema pointer, not "password").
    await waitFor(
      () =>
        canvasElement.querySelector("zitadel-login")?.shadowRoot?.querySelectorAll("zl-field")
          .length === 1,
    );
  },
};

/**
 * Recover (forgot-password) step, reached from the identifier's "Forgot
 * password?" link. The step has no fields of its own, so the play waits for the
 * email field to disappear once the recover screen renders.
 */
export const RecoverStep: Story = {
  play: async ({ canvasElement }) => {
    const login = canvasElement.querySelector("zitadel-login");
    const link = await waitFor(() =>
      [...(login?.shadowRoot?.querySelectorAll("a") ?? [])].find((a) =>
        /forgot/i.test(a.textContent ?? ""),
      ),
    );
    (link as HTMLAnchorElement).click();
    await waitFor(
      () =>
        login?.shadowRoot != null &&
        login.shadowRoot.querySelector('zl-field[name="email"]') == null &&
        login.shadowRoot.querySelector("form") != null,
    );
  },
};

/**
 * The terminal "you're signed in" step (`complete: "show"`), reached by walking
 * a full sign-in. A hosted surface with a `post-sign-in-url` would redirect
 * instead; without one the completion screen stays put.
 */
export const SignedIn: Story = {
  play: async ({ canvasElement }) => {
    await fill(canvasElement, "email", "ada@example.com");
    await submit(canvasElement);
    await waitFor(() =>
      canvasElement
        .querySelector("zitadel-login")
        ?.shadowRoot?.querySelector(`zl-field[name="${PASSWORD_FIELD}"]`),
    );
    await fill(canvasElement, PASSWORD_FIELD, "hunter2password");
    await submit(canvasElement);
    await waitFor(() => {
      const sr = canvasElement.querySelector("zitadel-login")?.shadowRoot;
      return sr != null && sr.querySelector("zl-field") == null && sr.querySelector("zl-button") != null;
    });
  },
};
