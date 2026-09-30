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

/**
 * Wait for the orchestrator to render a field and fill it, then press the
 * primary action. The atoms live in a shadow root, so the story reaches
 * through it rather than querying the document.
 */
async function fill(canvasElement: HTMLElement, name: string, value: string): Promise<void> {
  const login = canvasElement.querySelector("zitadel-login");
  const field = await waitFor(() => login?.shadowRoot?.querySelector(`zl-field[name="${name}"]`));
  const input = await waitFor(() => (field as HTMLElement).shadowRoot?.querySelector("input"));
  const el = input as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

async function submit(canvasElement: HTMLElement): Promise<void> {
  const login = canvasElement.querySelector("zitadel-login");
  const form = await waitFor(() => login?.shadowRoot?.querySelector("form"));
  (form as HTMLFormElement).requestSubmit();
}

async function waitFor<T>(probe: () => T | null | undefined, timeout = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 24));
  }
}

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

/**
 * Coming back from the provider as a new identity: the step collects what the
 * provider did not supply, which is the name the schema wants and Google's
 * claim does not always carry.
 *
 * The browser's trip to the provider cannot happen inside a story — choosing a
 * button navigates the whole page to the authorization endpoint — so the mock
 * is put where the callback leaves it (`returnFromProvider`) and the
 * orchestrator resumes that flow, which is exactly what the real callback page
 * does with `?flow=<id>`.
 */
export const RegisterAfterProvider: Story = {
  args: { sso: true },
  render: ({ purpose, theme }) => {
    const flowId = mock.returnFromProvider({ provider: "google", email: "ada@example.com" });
    return html`<zitadel-login
      variant="page"
      .purpose=${purpose}
      theme=${theme}
      resume-flow-id=${flowId}
    ></zitadel-login>`;
  },
};

/**
 * The same return, for an email that already has an account here. The provider
 * must not mint a second one, so the step asks the user to prove the account is
 * theirs with a method the schema enables.
 */
export const ConflictAfterProvider: Story = {
  args: { sso: true },
  render: ({ purpose, theme }) => {
    const flowId = mock.returnFromProvider({ provider: "google", email: "exists@example.com" });
    return html`<zitadel-login
      variant="page"
      .purpose=${purpose}
      theme=${theme}
      resume-flow-id=${flowId}
    ></zitadel-login>`;
  },
};
