import { applyBranding, clearBranding } from "@zitadel/api-mock";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { http, HttpResponse } from "msw";
import { html } from "lit";
import { initialize, mswLoader } from "msw-storybook-addon";

import "@zitadel/components";

import { brandingPresets, type BrandingPresetId } from "./branding-presets.js";

// Idempotent: the orchestrator story may have already started the worker.
initialize({ onUnhandledRequest: "bypass" });

const STORY_IDENTIFIER = "qwertz@acme.com";

const sessionHandlers = [
  http.get("*/sessions/me", () =>
    HttpResponse.json({
      session_id: "sess_story",
      project_id: "storybook",
      state: "active",
      user_id: "user_story",
      factors: [],
      assurance_levels: [],
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      user: {
        user_id: "user_story",
        identifier: STORY_IDENTIFIER,
        identifier_property: "email",
      },
    }),
  ),
  http.delete("*/sessions/me", () => new HttpResponse(null, { status: 204 })),
];

/**
 * `<zitadel-session>` is the post-sign-in "signed in" card (Figma `7355:8959`)
 * — the companion to `<zitadel-login>` for the "go straight to /login" flow.
 *
 * It fetches the signed-in identity (the user ref's display → identifier
 * chain) from `GET /sessions/me`; here that endpoint is
 * mocked via `msw-storybook-addon`. The Sign out action calls the real
 * `revokeMySession` endpoint, so the story is excluded from the Storybook test
 * run (`no-test`).
 */
interface SessionArgs {
  branding: BrandingPresetId;
}

const meta: Meta<SessionArgs> = {
  title: "Orchestrator/Session",
  tags: ["no-test"],
  loaders: [mswLoader],
  parameters: { layout: "fullscreen", msw: { handlers: sessionHandlers } },
  args: { branding: "centered" },
  argTypes: {
    branding: {
      control: "select",
      options: Object.keys(brandingPresets),
      description: "Tenant branding applied to the card tokens.",
    },
  },
  beforeEach: ({ args }) => {
    clearBranding();
    applyBranding(brandingPresets[args.branding]);
  },
  // The fullscreen story shows the dedicated signed-in route, which opts
  // into the page variant — the element itself now defaults to the
  // content-sized `widget` like `<zitadel-login>`.
  render: () => html`<zitadel-session variant="page"></zitadel-session>`,
};

export default meta;
type Story = StoryObj<SessionArgs>;

/** Default signed-in card: heading, resolved identifier, and the Sign out action. */
export const SignedIn: Story = {};

/** Same card with split-layout tenant branding tokens. */
export const SplitBranding: Story = { args: { branding: "split" } };
