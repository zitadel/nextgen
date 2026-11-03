import { CUSTOM_PROVIDER } from "@zitadel/config/idp";

import type { Rule } from "../../../lib/oclif/rules";

const SETTINGS = [
  { key: "ssoSlug", flag: "--sso-slug" },
  { key: "ssoDisplayName", flag: "--sso-display-name" },
  { key: "ssoIssuer", flag: "--sso-issuer" },
  { key: "ssoScopes", flag: "--sso-scopes" },
];

/**
 * Refuses a custom connection setting beside a catalog provider, which knows
 * its own name, issuer and scopes: a setting given alongside it would be
 * ignored, and an ignored flag reads as honoured.
 */
export const settingsNeedCustomRule: Rule = {
  broken: (view) => {
    const provider = view.flags.sso;
    if (provider === undefined || provider === CUSTOM_PROVIDER) {
      return false;
    }
    const given = SETTINGS.filter((setting) => view.flags[setting.key] !== undefined).map(
      (setting) => setting.flag,
    );
    if (given.length === 0) {
      return false;
    }
    return {
      names: given.join(", "),
      them: given.length === 1 ? "it" : "them",
      flags: given,
    };
  },
  refusal: {
    message: "{names} only applies to a custom connection",
    hint: `Add --sso ${CUSTOM_PROVIDER}, or remove {them}.`,
    details: {
      flags: "{flags}",
    },
  },
};
