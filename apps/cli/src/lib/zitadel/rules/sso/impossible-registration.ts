import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { quote } from "@/lib/zitadel/rules/sso/shared";

/**
 * A register step offers a provider whose provisioning.creation is "disabled".
 *
 * @remarks
 * Why it matters: The provider can sign existing users in but can never register a new one, so the
 * button on a sign-up page leads nowhere for a new user. It is only a warning because returning
 * users can still use it.
 *
 * Reported once: Only the entry step of the register purpose is judged, and not when the login
 * journey also reaches it, because there the button can still sign someone in.
 *
 * Fix: Set creation to "auto" in the connection file, or offer the provider on a login step
 * instead.
 *
 * Origin: #3287 (Impossible Registration of #1083);
 * docs/design/idp/1-resource-model.md#validator-rules.
 */
export const IMPOSSIBLE_REGISTRATION: Rule = defineRule({
  id: "sso/impossible-registration",
  severity: "warning",
  each: (config) => {
    return config.flows.offers.flatMap((offer) => {
      const connection = offer.connection;
      if (connection === undefined || connection.createsUsers) {
        return [];
      }
      if (offer.flow.registerEntry?.name !== offer.step.name) {
        return [];
      }
      const signsIn = offer.flow.loginJourney.some((step) => {
        return step.name === offer.step.name;
      });
      if (signsIn) {
        return [];
      }
      return [{ ...offer, connection }];
    });
  },
  file: (fact) => {
    return fact.flow.path;
  },
  steps: {
    step: (fact) => {
      return fact.step.name;
    },
    cause: (fact) => {
      return fact.slug;
    },
  },
  says: (fact, where) => {
    return `${where}: ${quote(fact.slug)} offers registration, but provisioning.creation of ${fact.connection.path} is "disabled", so it can sign existing users in and can never register a new one. Set creation to "auto" in ${fact.connection.path}, or offer it on a login step instead.`;
  },
});
