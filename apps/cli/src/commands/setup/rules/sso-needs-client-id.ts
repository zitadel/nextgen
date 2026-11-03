import { CUSTOM_PROVIDER, parseProviderSelection, providerOf } from "@zitadel/config/idp";

import type { Rule } from "../../../lib/oclif/rules";

/**
 * Refuses `--sso` without `--sso-client-id` when nobody can be asked for it:
 * a run that named a provider on the command line is scripted, and stopping to
 * ask would hang it. A person at a terminal is asked instead.
 */
export const ssoNeedsClientIdRule: Rule = {
  broken: (view) => {
    const provider = view.flags.sso;
    if (typeof provider !== "string" || view.flags.ssoClientId !== undefined) {
      return false;
    }
    const scripted = Boolean(
      view.flags.nonInteractive ||
        view.flags.json ||
        !(process.stdout.isTTY && process.stdin.isTTY),
    );
    if (!scripted) {
      return false;
    }
    const issuer = view.flags.ssoIssuer;
    const entry = provider === CUSTOM_PROVIDER ? undefined : parseProviderSelection(provider);
    const catalog = entry === undefined ? undefined : providerOf(entry);
    if (catalog?.consoleUrl !== undefined) {
      return {
        registration: `an OAuth application at ${catalog.consoleUrl}`,
      };
    }
    return {
      registration: `a client at ${catalog?.issuer ?? String(issuer)}`,
    };
  },
  refusal: {
    message: "--sso {sso} needs --sso-client-id",
    hint: "Register {registration} and pass its client id.",
  },
};
