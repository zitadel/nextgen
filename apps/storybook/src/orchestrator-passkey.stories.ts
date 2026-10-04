import type { StoryObj } from "@storybook/web-components-vite";
import { mswLoader } from "msw-storybook-addon";

import {
  clickAction,
  freezePasskeyCeremony,
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
  loaders: [mswLoader],
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
 * in with a passkey" on the identifier. That step mounts the invisible
 * `<zl-passkey>`, which fires a real `navigator.credentials.get()` ceremony -- the
 * OS passkey prompt -- the moment it renders. `freezePasskeyCeremony` stands in for
 * that browser API with a promise that never settles, so the step shows its real
 * in-flight state (the "waiting for your passkey" status + Cancel) instead of
 * raising a prompt that cannot complete in the workbench. The legacy
 * `passkey-setup` / `passkey-upsell` pair is deliberately not storied -- the
 * default flow no longer routes through it. See apps/storybook/AGENTS.md.
 */
export const PasskeyLogin: Story = {
  args: { passkey: true },
  beforeEach: () => freezePasskeyCeremony(),
  play: async ({ canvasElement }) => {
    await clickAction(canvasElement, "passkey");
    await waitFor(() =>
      canvasElement
        .querySelector("zitadel-login")
        ?.shadowRoot?.querySelector('[data-testid="zitadel-passkey-pending"]'),
    );
  },
};
