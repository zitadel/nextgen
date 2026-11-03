import { CUSTOM_PROVIDER } from "@zitadel/config/idp";

import { customExample, SETUP_FLAG_NAMES } from "../../../lib/idp";
import type { Rule } from "../../../lib/oclif/rules";

const REQUIRED = [
  { key: "ssoSlug", flag: "--sso-slug" },
  { key: "ssoDisplayName", flag: "--sso-display-name" },
  { key: "ssoIssuer", flag: "--sso-issuer" },
];

/**
 * Refuses `--sso custom` that does not describe the connection when nobody can
 * be asked for what is missing. A person at a terminal is asked instead.
 */
export const customConnectionIncompleteRule: Rule = {
  broken: (view) => {
    if (view.flags.sso !== CUSTOM_PROVIDER) {
      return false;
    }
    const scripted = Boolean(view.flags.nonInteractive || view.flags.json || !process.stdin.isTTY);
    const missing = REQUIRED.filter((setting) => view.flags[setting.key] === undefined).map(
      (setting) => setting.flag,
    );
    if (!scripted || missing.length === 0) {
      return false;
    }
    return {
      list: missing.join(", "),
      missing,
    };
  },
  refusal: {
    message: "A custom connection needs {list}",
    hint: `Describe the connection, e.g. ${customExample(SETUP_FLAG_NAMES)}`,
    details: {
      missing: "{missing}",
    },
  },
};
