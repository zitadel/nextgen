import type { StoryObj } from "@storybook/web-components-vite";

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
  parameters: {
    layout: "fullscreen",
    msw: { handlers: mock.handlers },
  },
  args: { ...orchestratorDefaultArgs, passkey: true },
  argTypes: {
    ...orchestratorArgTypes,
    // This group is defined by passkeys being enabled on a login flow, so lock
    // the two controls that would break it: `purpose` (passkey is offered only
    // on the identifier step, so `register` has no passkey action) and `passkey`
    // itself (turning it off removes the action these stories depend on, timing
    // out PasskeyLogin's play). The rest — variant, theme, branding, sso — stay.
    purpose: {
      ...orchestratorArgTypes.purpose,
      control: false,
      table: { ...orchestratorArgTypes.purpose.table, disable: true },
    },
    passkey: {
      ...orchestratorArgTypes.passkey,
      control: false,
      table: { ...orchestratorArgTypes.passkey.table, disable: true },
    },
  },
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
 * OS passkey prompt -- the instant it renders, and that can't complete in the
 * workbench. `freezePasskeyCeremony` stubs `navigator.credentials` with a promise
 * that never settles (kept in the workbench, not on the shipped component), so the
 * atom stays in its in-flight state and shows the real "waiting for your passkey"
 * UI instead of raising the prompt; the returned teardown restores it. The legacy
 * `passkey-setup` / `passkey-upsell` pair is deliberately not storied -- the
 * default flow no longer routes through it. See apps/storybook/AGENTS.md.
 */
export const PasskeyLogin: Story = {
  args: { passkey: true },
  // This story drives a fixed identifier → passkey-login journey, so the
  // operator-preview control doesn't apply (preview freezes the entry step and
  // submits nothing). Lock it rather than let it silently no-op in the URL.
  argTypes: {
    previewState: { control: false, table: { disable: true } },
  },
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
