import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { quote } from "@/lib/zitadel/rules/sso/shared";

export const IMPOSSIBLE_REGISTRATION: Rule = defineRule({
  id: "sso/impossible-registration",
  severity: "warning",
  // Only the register purpose's entry step counts, and not when the login
  // journey also reaches it: there the button can still sign someone in.
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
