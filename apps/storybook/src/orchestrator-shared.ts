import type { Meta } from "@storybook/web-components-vite";
import {
  applyBranding,
  applySsoProviders,
  clearBranding,
  clearSsoProviders,
  setupMockHandlers,
} from "@zitadel/api-mock";
import { html } from "lit";
import { mswLoader } from "msw-storybook-addon";
import { LOGIN_PREVIEW_STATES, type LoginPreviewState } from "@zitadel/components";
import { brandingPresets, type BrandingPresetId } from "./branding-presets.js";

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
 *   which is what the flow looks like after `zitadel auth-method sso enable`. The shipped
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
export interface OrchestratorArgs {
  purpose: "login" | "register";
  branding: BrandingPresetId;
  theme: "" | "light" | "dark" | "auto";
  sso: boolean;
  previewState: "" | LoginPreviewState;
}

export const mock = setupMockHandlers();

/**
 * What `zitadel auth-method sso enable --provider google` leaves in the flow, plus a tenant's own OIDC
 * connection — the second one has no brand mark, which is what every provider
 * looks like before its artwork lands.
 */
export const SSO_PROVIDERS = [
  { id: "google", name: "Google", template: "google" },
  { id: "acme", name: "Acme SSO", template: "oidc-generic" },
];

/**
 * The shared setup every `<zitadel-login>` story group uses: one mock, one set
 * of knobs, one branding overlay. Each group spreads this and adds its own
 * `title` -- splitting the provider journeys into `Orchestrator/Login/SSO`
 * must not fork the mock, or the two groups would answer from different flow
 * machines.
 *
 * Spread into a literal rather than returned by a helper: Storybook's CSF
 * indexer reads the default export statically and rejects a call expression.
 */
export const orchestratorBase = {
  tags: ["no-test"],
  loaders: [mswLoader],
  parameters: {
    layout: "fullscreen",
    msw: { handlers: mock.handlers },
  },
  args: { purpose: "login", branding: "centered", theme: "", sso: false, previewState: "" },
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
        "Offer identity providers on the steps a sign-in can start from, as a project that ran `zitadel auth-method sso enable` has.",
    },
    previewState: {
      control: "select",
      options: ["", ...LOGIN_PREVIEW_STATES],
      description:
        "Preview mode: show the served step in a state and submit nothing. Empty runs the flow for real.",
    },
  },
  beforeEach: ({ args }) => {
    mock.reset();
    clearBranding();
    applyBranding(brandingPresets[args.branding]);
    clearSsoProviders();
    if (args.sso) applySsoProviders(SSO_PROVIDERS);
  },
  render: ({ purpose, theme, previewState }) =>
    html`<zitadel-login
      variant="page"
      .purpose=${purpose}
      theme=${theme}
      preview-state=${previewState}
    ></zitadel-login>`,
} satisfies Omit<Meta<OrchestratorArgs>, "title">;

/**
 * Wait for the orchestrator to render a field and fill it, then press the
 * primary action. The atoms live in a shadow root, so the story reaches
 * through it rather than querying the document.
 */
export async function fill(canvasElement: HTMLElement, name: string, value: string): Promise<void> {
  const login = canvasElement.querySelector("zitadel-login");
  const field = await waitFor(() => login?.shadowRoot?.querySelector(`zl-field[name="${name}"]`));
  const input = await waitFor(() => (field as HTMLElement).shadowRoot?.querySelector("input"));
  const el = input as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

export async function submit(canvasElement: HTMLElement): Promise<void> {
  const login = canvasElement.querySelector("zitadel-login");
  const form = await waitFor(() => login?.shadowRoot?.querySelector("form"));
  (form as HTMLFormElement).requestSubmit();
}

export async function waitFor<T>(probe: () => T | null | undefined, timeout = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 24));
  }
}

export const orchestratorDefaultArgs = orchestratorBase.args;
export const orchestratorArgTypes = orchestratorBase.argTypes;
export const orchestratorBeforeEach = orchestratorBase.beforeEach;
export const orchestratorRender = orchestratorBase.render;
