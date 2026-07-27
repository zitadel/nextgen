import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { applyBranding, clearBranding, setupMockHandlers } from "@zitadel/api-mock";
import { html } from "lit";
import { initialize, mswLoader } from "msw-storybook-addon";
import "@zitadel/components";
import { brandingPresets, type BrandingPresetId } from "./branding-presets.js";

// MSW lives only on the orchestrator (the atoms make no requests), so the
// worker starts lazily here rather than globally in preview.ts.
initialize({ onUnhandledRequest: "bypass" });

/**
 * The `<zitadel-login>` orchestrator renders whatever the Flow API returns for
 * the current step. Here that API is mocked by `@zitadel/api-mock` (an xstate
 * flow machine + orval-typed fixtures), wired through `msw-storybook-addon`.
 *
 * One component, knobs for the rest:
 * - `purpose` switches the flow (Sign in -> email, then the credential on its
 *   own step; Sign up -> email, given name, family name, date of birth), so the
 *   rendered fields change without a separate component.
 * - `branding` swaps the tenant payload the mock overlays on every response.
 *
 * Interactive fixture emails (typed live in the rendered form):
 * - `wrong@example.com` -> inline "Wrong email or password." on the password
 *   step (credential failures surface there, not on the identifier)
 * - `server@example.com` -> form alert on the password step
 * - `exists@example.com` -> inline "account already exists" on Sign up
 * - any other email -> happy path to signed-in
 *
 * Excluded from the Storybook test run (`no-test`): the orchestrator drives
 * real network + the MSW worker; its behaviour is covered by the
 * `@zitadel/components` orchestrator specs.
 */
interface OrchestratorArgs {
  purpose: "login" | "register";
  branding: BrandingPresetId;
}

const mock = setupMockHandlers();

const meta: Meta<OrchestratorArgs> = {
  title: "Orchestrator/Login",
  tags: ["no-test"],
  loaders: [mswLoader],
  parameters: {
    layout: "fullscreen",
    msw: { handlers: mock.handlers },
  },
  args: { purpose: "login", branding: "centered" },
  argTypes: {
    purpose: {
      control: "inline-radio",
      options: ["login", "register"],
      description: "Flow purpose — which step (and fields) the mock returns.",
    },
    branding: {
      control: "select",
      options: Object.keys(brandingPresets),
      description: "Tenant branding the mock overlays on every response.",
    },
  },
  beforeEach: ({ args }) => {
    mock.reset();
    clearBranding();
    applyBranding(brandingPresets[args.branding]);
  },
  render: ({ purpose }) =>
    html`<zitadel-login variant="page" .purpose=${purpose}></zitadel-login>`,
};

export default meta;
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
