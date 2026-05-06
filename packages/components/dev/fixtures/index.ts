/**
 * Fixture data for the dev playground. Mirrors the canonical step shape in
 * `docs/design/flowengine/flow-engine-guide.md` and the branding shape in
 * `docs/design/branding/branding.example.json`.
 *
 * The playground feeds these into {@link WalkingFixtureTransport} so the
 * orchestrator walks `step.transitions` like the real backend will.
 */
import type {
  Branding,
  FlowDefinition,
  WalkingFixtureOptions,
} from "../../src/orchestrator/index.js";

export const loginFlow: FlowDefinition = {
  name: "default-login",
  purposes: ["login"],
  initial_steps: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      type: "identifier",
      texts: {
        title_key: "identifier.title",
        description_key: "identifier.description",
      },
      fields: {
        email: {
          type: "email",
          text_key: "identifier.field.email",
          autocomplete: "username",
          required: true,
        },
      },
      actions: { submit: { text_key: "submit.continue", primary: true } },
      transitions: { submit: "password" },
    },
    {
      name: "password",
      type: "credential",
      texts: {
        title_key: "password.title",
        description_key: "password.description",
      },
      fields: {
        password: {
          type: "password",
          text_key: "password.field.password",
          autocomplete: "current-password",
          required: true,
        },
      },
      actions: { submit: { text_key: "submit.signin", primary: true } },
      transitions: { submit: "done" },
    },
    {
      name: "done",
      type: "complete",
      texts: { title_key: "complete.title" },
    },
  ],
};

/**
 * Decorator hook used by the playground walker. Re-attaches whatever the
 * user typed during the identifier step to `identity.display_name` so the
 * password step can render "Welcome back, {0}" with their email.
 */
export const decorateLoginStep: WalkingFixtureOptions["decorate"] = (step, ctx) => {
  if (step.name !== "password") return step;
  const values = ctx.payload.values as Record<string, string> | undefined;
  const email = values?.email?.trim();
  return email ? { ...step, identity: { display_name: email } } : step;
};

export const brandingPresets = {
  centered: {
    layout: "centered",
    logo_url: new URL("../assets/zitadel-logo-light.svg", import.meta.url).href,
    palette: {
      primary: "#4A90D9",
      on_primary: "#FFFFFF",
      background: "#F8FAFC",
      surface: "#FFFFFF",
      muted: "#F1F5F9",
      border: "#E2E8F0",
      text: "#0F172A",
      text_muted: "#64748B",
      link: "#2563EB",
    },
    typography: {
      font_family: "'Inter', ui-sans-serif, system-ui, sans-serif",
    },
    shape: { radius: "md", density: "regular" },
  } satisfies Branding,
  split: {
    layout: "split",
    logo_url: new URL("../assets/zitadel-logo-dark.svg", import.meta.url).href,
    hero_url:
      "https://images.unsplash.com/photo-1505765050516-f72dcac9c60e?auto=format&fit=crop&w=1280&q=60",
    palette: {
      primary: "#4A90D9",
      on_primary: "#FFFFFF",
      background: "#FFFFFF",
      surface: "#FFFFFF",
      muted: "#F1F5F9",
      border: "#E2E8F0",
      text: "#0F172A",
      text_muted: "#64748B",
    },
    typography: { font_family: "'Inter', ui-sans-serif, system-ui, sans-serif" },
  } satisfies Branding,
  dark: {
    layout: "centered",
    logo_url: new URL("../assets/zitadel-logo-dark.svg", import.meta.url).href,
    palette: {
      primary: "#7C9CFF",
      on_primary: "#0A0A0A",
      background: "#0A0A0A",
      surface: "#111111",
      muted: "#1A1A1A",
      border: "#262626",
      text: "#FAFAFA",
      text_muted: "#A1A1AA",
      link: "#9DBBFF",
    },
    typography: { font_family: "'Inter', ui-sans-serif, system-ui, sans-serif" },
    shape: { radius: "md", density: "regular" },
    theme: { mode: "dark" },
  } satisfies Branding,
} as const;

export type BrandingPresetId = keyof typeof brandingPresets;
