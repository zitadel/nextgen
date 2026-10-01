import type { StoryObj } from "@storybook/web-components-vite";
import { html } from "lit";
import { mswLoader } from "msw-storybook-addon";

import {
  orchestratorArgTypes,
  orchestratorBeforeEach,
  orchestratorDefaultArgs,
  orchestratorRender,
  mock,
  type OrchestratorArgs,
} from "./orchestrator-shared.js";

/**
 * The provider journeys, grouped on their own so the ordinary sign-in stories
 * stay readable: a step offering providers, and each branch a provider's
 * return takes. They share the sign-in group's mock and knobs -- `sso` is on
 * by default here, which is the only difference.
 */
// Written out rather than spread from the shared base: Storybook reads a CSF
// default export statically, and a spread of an imported object left this
// group with no `parameters` at all -- so no MSW handlers, so every story here
// fell through to the dev server and answered 404. The values still come from
// one place; only the shape is literal.
export default {
  title: "Orchestrator/Login/SSO",
  tags: ["no-test"],
  loaders: [mswLoader],
  parameters: {
    layout: "fullscreen",
    msw: { handlers: mock.handlers },
  },
  args: { ...orchestratorDefaultArgs, sso: true },
  argTypes: orchestratorArgTypes,
  beforeEach: orchestratorBeforeEach,
  render: orchestratorRender,
};
type Story = StoryObj<OrchestratorArgs>;

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
