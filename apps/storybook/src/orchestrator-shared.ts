import type { Meta } from "@storybook/web-components-vite";
import {
  applyBranding,
  applyPasskey,
  applySsoProviders,
  clearBranding,
  clearSsoProviders,
  setupMockHandlers,
  type MockSsoProvider,
} from "@zitadel/api-mock";
import { html } from "lit";
import {
  LOGIN_PREVIEW_STATES,
  SHIPPED_BRAND_ICON_NAMES,
  type LoginPreviewState,
} from "@zitadel/components";
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
export interface OrchestratorArgs {
  purpose: "login" | "register";
  variant: "widget" | "page";
  branding: BrandingPresetId | "none";
  theme: "" | "light" | "dark" | "auto";
  sso: SsoChoice;
  passkey: boolean;
  previewState: "" | LoginPreviewState;
}

/** Whether the mocked flow offers identity providers — a scalar so it stays in
 * the shareable Storybook URL. */
export type SsoChoice = "off" | "on";

export const mock = setupMockHandlers();

/**
 * The providers the mock offers when `sso` is on, **derived from the component
 * library** instead of a hard-coded list: every brand mark `@zitadel/components`
 * ships (`SHIPPED_BRAND_ICON_NAMES`, e.g. `brand-google`) becomes a provider whose
 * button carries that logo. Add a glyph there and it appears here automatically —
 * no Google/GitHub to drift out of sync, and no dependency on `@zitadel/config`
 * (Storybook already depends on `@zitadel/components`, not on config).
 */
const BRAND_PROVIDERS: MockSsoProvider[] = SHIPPED_BRAND_ICON_NAMES.map((brand) => {
  const template = brand.replace(/^brand-/, "");
  return { id: template, name: template.charAt(0).toUpperCase() + template.slice(1), template };
});

/**
 * A single synthetic provider the component ships no brand mark for, appended to
 * the derived set so the stories keep demonstrating the label-only fallback:
 * `<zl-sso-providers>` renders a provider with no matching glyph as a plain
 * labelled button. Not a real provider — a deliberate UI-state fixture.
 */
const NO_MARK_PROVIDER: MockSsoProvider = { id: "acme", name: "Acme Corp", template: "acme" };

/** Provider set per `sso` choice. `on` = every shipped brand + the no-mark
 * fallback, so list rendering (and the glyph-less case) are both visible. */
const SSO_SETS: Record<SsoChoice, readonly MockSsoProvider[]> = {
  off: [],
  on: [...BRAND_PROVIDERS, NO_MARK_PROVIDER],
};

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
  parameters: {
    layout: "fullscreen",
    msw: { handlers: mock.handlers },
  },
  args: {
    purpose: "login",
    variant: "page",
    branding: "centered",
    theme: "",
    sso: "off",
    passkey: false,
    previewState: "",
  },
  argTypes: {
    // Two sections in the Controls panel: props the host sets on the
    // `<zitadel-login>` element, and the values the flow engine (here, the
    // mock backend) returns in its responses.
    purpose: {
      control: {
        type: "inline-radio",
        labels: { login: "login (sign in)", register: "register (sign up)" },
      },
      options: ["login", "register"],
      description:
        "Host prop `purpose`: which flow to run — `login` (sign in) or `register` (sign up). Decides the first step, and the fields, the mock returns.",
      table: {
        category: "Component",
        type: { summary: '"login" | "register"' },
        defaultValue: { summary: "login" },
      },
    },
    variant: {
      control: {
        type: "inline-radio",
        labels: { page: "page (full-page)", widget: "widget (embedded)" },
      },
      options: ["page", "widget"],
      description:
        "Host prop `variant`: how the element fills its container. `page` = fills its box and paints its own background (a full-page login; default theme `dark`). `widget` = shrinks to its content and stays transparent, to embed inside your own page (default theme `auto`).",
      table: {
        category: "Component",
        type: { summary: '"page" | "widget"' },
        // The element's own default is `widget`; these stories render `page`.
        defaultValue: { summary: "widget" },
      },
    },
    theme: {
      control: {
        type: "select",
        labels: {
          "": "unset (defer to branding)",
          light: "light",
          dark: "dark",
          auto: "auto (follow OS)",
        },
      },
      options: ["", "light", "dark", "auto"],
      description:
        "Host prop `theme`: the embedding page's colour-mode preference. `unset` defers to the branding's own mode; `light`/`dark` force a side; `auto` follows the visitor's OS. Takes precedence over the branding's mode — EXCEPT a branding that publishes only one side forces that side and ignores this (e.g. `dark`, `light-only`).",
      table: {
        category: "Component",
        type: { summary: '"" | "light" | "dark" | "auto"' },
        defaultValue: { summary: "unset" },
      },
    },
    previewState: {
      control: {
        type: "select",
        labels: { "": "unset (run the flow for real)" },
      },
      options: ["", ...LOGIN_PREVIEW_STATES],
      description:
        "Host prop `preview-state` (operator preview): freeze the current step in a visual state — e.g. `validation_error`, `loading`, `success` — and submit nothing. `unset` runs the flow for real.",
      table: { category: "Component", defaultValue: { summary: "unset" } },
    },
    branding: {
      control: {
        type: "select",
        // Surface the single-sided gating at point of use: a preset that ships
        // both palette sides lets `theme` toggle; a single-sided one forces its
        // side. Presets not listed here fall back to their raw key.
        labels: {
          none: "none (design-system defaults)",
          centered: "centered (both modes)",
          "two-sided": "two-sided (both modes)",
          dark: "dark (single-sided)",
          "light-only": "light-only (single-sided)",
          split: "split (single-sided)",
        },
      },
      options: ["none", ...Object.keys(brandingPresets)],
      description:
        "Backend-returned branding the mock overlays on every response (the component has no `branding` prop — it renders what the flow engine sends). `none` = no branding, so the component uses its design-system defaults (which ship both light and dark). Presets ending in a single side (`dark`, `light-only`) demonstrate the single-sided gating on `theme`.",
      table: { category: "Flow engine", defaultValue: { summary: "none" } },
    },
    sso: {
      control: {
        type: "inline-radio",
        labels: { off: "off (shipped default)", on: "on (every shipped provider)" },
      },
      options: ["off", "on"],
      description:
        "Backend-returned identity providers on sign-in-capable steps, as `zitadel sso enable` leaves them. `off` = the shipped default (none). `on` = every provider `@zitadel/components` ships a brand mark for (derived from `SHIPPED_BRAND_ICON_NAMES`) plus one without a mark to show the labelled-button fallback. Rendered as `<zl-sso-providers>`.",
      table: { category: "Flow engine", defaultValue: { summary: "off" } },
    },
    passkey: {
      control: "boolean",
      description:
        "Backend-returned passkey offer: when on, the identifier step gains a `Sign in with a passkey` action (as a project with passkeys enabled sends). Choosing it advances the flow to the separate `passkey-login` step. Off is the shipped default.",
      table: { category: "Flow engine", defaultValue: { summary: "false" } },
    },
  },
  beforeEach: ({ args }) => {
    mock.reset();
    clearBranding();
    if (args.branding !== "none") applyBranding(brandingPresets[args.branding]);
    clearSsoProviders();
    const providers = SSO_SETS[args.sso];
    if (providers.length > 0) applySsoProviders(providers);
    applyPasskey(args.passkey);
  },
  render: ({ purpose, variant, theme, previewState }) =>
    html`<zitadel-login
      variant=${variant}
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

/**
 * Click a named step action (e.g. `passkey`, `recover`) rather than the primary
 * submit. The orchestrator renders each action as `<zl-button action="…">`; this
 * clicks its inner native button, the same path a visitor takes, so the mock
 * sees a real `SUBMIT` with that action.
 */
export async function clickAction(canvasElement: HTMLElement, action: string): Promise<void> {
  const login = canvasElement.querySelector("zitadel-login");
  const button = await waitFor(() =>
    login?.shadowRoot?.querySelector(`zl-button[action="${action}"]`),
  );
  const inner = await waitFor(() => (button as HTMLElement).shadowRoot?.querySelector("button"));
  (inner as HTMLButtonElement).click();
}

/**
 * Freeze the WebAuthn ceremony so a passkey step can be shown in the workbench.
 *
 * `<zl-passkey>` auto-runs a real `navigator.credentials` ceremony the instant it
 * mounts — the OS passkey prompt — which can never complete here. This swaps the
 * two ceremony entry points for a promise that never settles (`Promise.race([])`,
 * the same stub the component's own specs use), so the atom stays `pending` and
 * renders its real "waiting for your passkey" UI instead of raising the platform
 * prompt. It mocks a browser API exactly as `msw` mocks the network, and keeps the
 * suppression in the workbench rather than on the shipped component. Returns a
 * restore function for Storybook `beforeEach` teardown.
 */
export function freezePasskeyCeremony(): () => void {
  const never = (): Promise<Credential | null> => Promise.race<Credential | null>([]);
  const originalCredentials = Object.getOwnPropertyDescriptor(navigator, "credentials");
  const originalPublicKeyCredential = Object.getOwnPropertyDescriptor(
    window,
    "PublicKeyCredential",
  );
  // The ceremony guards on `window.PublicKeyCredential` before it starts; only
  // define a stub when the browser has none, so real Chrome's own class stays.
  if (!("PublicKeyCredential" in window)) {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: class PublicKeyCredentialStub {},
    });
  }
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: { get: never, create: never },
  });
  return () => {
    // `navigator.credentials` is normally an accessor on `Navigator.prototype`,
    // so there is no OWN descriptor to restore — defining the stub created one
    // that shadows the prototype. Delete it (don't just skip), or the
    // never-settling stub leaks into every later story.
    if (originalCredentials) {
      Object.defineProperty(navigator, "credentials", originalCredentials);
    } else {
      delete (navigator as unknown as Record<string, unknown>).credentials;
    }
    if (originalPublicKeyCredential) {
      Object.defineProperty(window, "PublicKeyCredential", originalPublicKeyCredential);
    } else {
      delete (window as unknown as Record<string, unknown>).PublicKeyCredential;
    }
  };
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
