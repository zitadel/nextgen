import type { Meta, StoryObj } from "@storybook/web-components-vite";
import type { SsoProvider } from "@zitadel/components";
import { html } from "lit";

import "@zitadel/components/atoms";

const GOOGLE: SsoProvider = { id: "idp_01GOOGLE", name: "Google", template: "google" };
const PRIVATE: SsoProvider = { id: "idp_01ACME", name: "Acme SSO", template: "oidc-generic" };

interface SsoArgs {
  providers: SsoProvider[];
  labelFormat: string;
  dividerLabel: string;
  disabled: boolean;
}

/**
 * Provider buttons (`<zl-sso-providers>`) — one per entry in the step's
 * `sso_providers`, rendered in the order the engine sends them.
 *
 * The atom knows no vendors: a mark is looked up by the connection's
 * `template`, and a template without one still gets a working button. That is
 * what a tenant's own OIDC connection will always look like, and what every
 * provider looks like before its artwork lands.
 *
 * Choosing one emits `zl-sso-select`; the orchestrator turns that into the
 * reserved `sso` action and follows the redirect the server answers with. In
 * isolation there is nothing listening, so a chosen button simply emits and
 * nothing follows — the atom has no loading state of its own, only `disabled`,
 * which the orchestrator sets while the step submits.
 */
const meta: Meta<SsoArgs> = {
  title: "Atoms/SSO providers",
  tags: ["autodocs"],
  args: {
    // Both shapes at once, so the fallback is visible without editing the
    // control: Google ships a mark, a tenant's own OIDC connection has none
    // and gets a labelled button rather than a wrong logo.
    providers: [GOOGLE, PRIVATE],
    labelFormat: "Continue with {name}",
    // Off, as the shipped templates render it; type a label to see the rule.
    dividerLabel: "",
    disabled: false,
  },
  argTypes: {
    providers: { control: "object", description: "The step's `sso_providers`." },
    labelFormat: { control: "text", description: "`{name}` is replaced per provider." },
    dividerLabel: { control: "text", description: "Rule above the buttons; empty renders none." },
    disabled: { control: "boolean", description: "Set while the step is submitting." },
  },
};

export default meta;
type Story = StoryObj<SsoArgs>;

const render = ({ providers, labelFormat, dividerLabel, disabled }: SsoArgs) => html`
  <div style="max-width: 24rem">
    <zl-sso-providers
      providers=${JSON.stringify(providers)}
      label-format=${labelFormat}
      divider-label=${dividerLabel}
      ?disabled=${disabled}
    ></zl-sso-providers>
  </div>
`;

export const Default: Story = { render };
