import type { StoryObj } from "@storybook/web-components-vite";
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
 * Preview mode, as the console's branding screen uses it: the served step
 * with every required field flagged, and nothing submits. Switch
 * `previewState` for the other states.
 */
export const PreviewValidationErrors: Story = { args: { previewState: "validation_error" } };

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
        ?.shadowRoot?.querySelector('zl-field[name="password"]'),
    );
  },
};
