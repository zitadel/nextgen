import { type Rule, needs } from "../../../lib/oclif/rules";

/** Refuses `--sso-client-id` without the `--sso` provider it is the client id for. */
export const clientIdNeedsSsoRule: Rule = needs("ssoClientId", "sso", {
  message: "--sso-client-id needs --sso",
  hint: "Name the provider with --sso, e.g. --sso google.",
});
