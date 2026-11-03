import { CUSTOM_PROVIDER } from "@zitadel/config/idp";

import { type Rule, needs } from "../../../lib/oclif/rules";

const SETTINGS = [
  { key: "ssoSlug", flag: "--sso-slug" },
  { key: "ssoDisplayName", flag: "--sso-display-name" },
  { key: "ssoIssuer", flag: "--sso-issuer" },
  { key: "ssoScopes", flag: "--sso-scopes" },
];

/** Refuses a custom connection setting given with no `--sso` to attach it to. */
export const customSettingsNeedSsoRules: readonly Rule[] = SETTINGS.map((setting) => {
  return needs(setting.key, "sso", {
    message: `${setting.flag} needs --sso ${CUSTOM_PROVIDER}`,
    hint: `Name the provider with --sso ${CUSTOM_PROVIDER}.`,
  });
});
