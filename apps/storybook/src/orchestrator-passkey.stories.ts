import type { StoryObj } from "@storybook/web-components-vite";
import { html } from "lit";

import {
  clickAction,
  mock,
  orchestratorArgTypes,
  orchestratorBeforeEach,
  orchestratorDefaultArgs,
  orchestratorRender,
  waitFor,
  type OrchestratorArgs,
} from "./orchestrator-shared.js";

/**
 * The passkey journeys, grouped on their own so the ordinary sign-in stories
 * stay readable: the offer on the identifier, and the dedicated ceremony step it
 * leads to. They share the sign-in group's mock and knobs -- `passkey` is on by
 * default here, which is the only difference.
 */
// Written out rather than spread from the shared base: Storybook reads a CSF
// default export statically, and a spread of an imported object left this group
// with no `parameters` at all -- so no MSW handlers, so every story here fell
// through to the dev server. The values still come from one place; only the
// shape is literal.
export default {
  title: "Orchestrator/Login/Passkeys",
  tags: ["no-test"],
  parameters: {
    layout: "fullscreen",
    msw: { handlers: mock.handlers },
  },
  args: { ...orchestratorDefaultArgs, passkey: true },
  argTypes: orchestratorArgTypes,
  beforeEach: orchestratorBeforeEach,
  render: orchestratorRender,
};
type Story = StoryObj<OrchestratorArgs>;

/**
 * Passkeys enabled on the project: the identifier step adds a "Sign in with a
 * passkey" action alongside the email field (the `passkey` flow-engine knob).
 * Choosing it drives the flow to the dedicated `passkey-login` step, where the
 * WebAuthn ceremony runs via the invisible `<zl-passkey>` -- see `PasskeyLogin`
 * for the step the choice leads to.
 */
export const PasskeyOffered: Story = { args: { passkey: true } };

/**
 * The dedicated passkey sign-in step (`passkey-login`), reached by choosing "Sign
 * in with a passkey" on the identifier. That step mounts `<zl-passkey>`, which
 * would normally fire a real `navigator.credentials.get()` ceremony -- the OS
 * passkey prompt -- the instant it renders. The host prop `manual-ceremony`
 * renders it inert instead (`<zl-passkey manual>`), so the passkey screen shows
 * without a prompt that cannot complete in the workbench. It's the step at rest:
 * the "waiting for your passkey" in-flight state is not shown, because nothing is
 * running. The legacy `passkey-setup` / `passkey-upsell` pair is deliberately not
 * storied -- the default flow no longer routes through it. See
 * apps/storybook/AGENTS.md.
 */
export const PasskeyLogin: Story = {
  args: { passkey: true },
  render: ({ purpose, variant, theme }) =>
    html`<zitadel-login
      variant=${variant}
      .purpose=${purpose}
      theme=${theme}
      ?manual-ceremony=${true}
    ></zitadel-login>`,
  play: async ({ canvasElement }) => {
    await clickAction(canvasElement, "passkey");
    await waitFor(() =>
      canvasElement.querySelector("zitadel-login")?.shadowRoot?.querySelector("zl-passkey"),
    );
  },
};
