import type { SsoProvider } from "@zitadel/components/atoms";

// The atoms the montage's shots keep reaching for, set up as the default
// template sets them up: the providers its steps offer, and its buttons.

export const GOOGLE: SsoProvider = { id: "idp_google", name: "Google", template: "google" };
export const GITHUB: SsoProvider = { id: "idp_github", name: "GitHub", template: "github" };
export const APPLE: SsoProvider = { id: "idp_apple", name: "Apple", template: "apple" };
export const ACME: SsoProvider = { id: "idp_acme", name: "Acme SSO", template: "oidc-generic" };

const CONTINUE_WITH = "Continue with {name}";

export const primary = (label: string, pressed = false) => (
  <zl-button
    hierarchy="primary"
    size="medium"
    type="button"
    label={label}
    block
    data-state={pressed ? "pressed" : undefined}
  />
);

export const secondary = (label: string) => (
  <zl-button hierarchy="secondary" size="medium" type="button" label={label} block />
);

export const providers = (list: SsoProvider[]) => (
  <zl-sso-providers providers={list} labelFormat={CONTINUE_WITH} />
);
