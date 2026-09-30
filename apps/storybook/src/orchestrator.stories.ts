import type { Meta, StoryObj } from "@storybook/web-components-vite";
import {
  applyBranding,
  applySsoProviders,
  clearBranding,
  clearSsoProviders,
  setupMockHandlers,
} from "@zitadel/api-mock";
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
 * - `sso` offers identity providers on the steps that can start a sign-in,
 *   which is what the flow looks like after `zitadel sso enable`. The shipped
 *   flow has none, so it is off by default.
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
  theme: "" | "light" | "dark" | "auto";
  sso: boolean;
}

const mock = setupMockHandlers();

/**
 * What `zitadel sso enable google` leaves in the flow, plus a tenant's own OIDC
 * connection — the second one has no brand mark, which is what every provider
 * looks like before its artwork lands.
 */
const SSO_PROVIDERS = [
  { id: "google", name: "Google", template: "google" },
  { id: "acme", name: "Acme SSO", template: "oidc-generic" },
];

const meta: Meta<OrchestratorArgs> = {
  title: "Orchestrator/Login",
  tags: ["no-test"],
  loaders: [mswLoader],
  parameters: {
    layout: "fullscreen",
    msw: { handlers: mock.handlers },
  },
  args: { purpose: "login", branding: "centered", theme: "", sso: false },
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
    theme: {
      control: "inline-radio",
      options: ["", "light", "dark", "auto"],
      description:
        "The embedding page's own preference. Empty defers to the revision's mode; a side the revision does not publish cannot be selected.",
    },
    sso: {
      control: "boolean",
      description:
        "Offer identity providers on the steps a sign-in can start from, as a project that ran `zitadel sso enable` has.",
    },
  },
  beforeEach: ({ args }) => {
    mock.reset();
    clearBranding();
    applyBranding(brandingPresets[args.branding]);
    clearSsoProviders();
    if (args.sso) applySsoProviders(SSO_PROVIDERS);
  },
  render: ({ purpose, theme }) =>
    html`<zitadel-login variant="page" .purpose=${purpose} theme=${theme}></zitadel-login>`,
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

/**
 * The identifier step once a project has enabled providers: the buttons sit
 * under the email field, on the tenant's own surface rather than the bare
 * atom canvas. Choosing one asks the server for a redirect, which the mock
 * answers with an `sso-redirect` step.
 */
export const WithSsoProviders: Story = { args: { sso: true } };

/** The same buttons on the sign-up step, which can also start a sign-in. */
export const SignUpWithSsoProviders: Story = { args: { sso: true, purpose: "register" } };
