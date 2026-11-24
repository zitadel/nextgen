import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { closest } from "@/lib/zitadel/utils/spelling";
import { heldByBrokenConnection, knownSlugs, quote } from "@/lib/zitadel/rules/sso/shared";

export const PROVIDER_ID: Rule = defineRule({
  id: "sso/provider-id",
  severity: "error",
  // The providers the schema lists without a connection file, as the
  // connections they most likely meant.
  each: (config) => {
    const known = knownSlugs(config);
    return config.flows.pinnedOffers.map((offer) => {
      const meant = offer.schema.providers
        .filter((slug) => {
          return config.connections.find(slug) === undefined;
        })
        .map((slug) => {
          return closest(slug, known);
        });
      return { ...offer, meant, broken: heldByBrokenConnection(config, offer.slug) };
    });
  },
  // A slug the schema lists without a connection file is most likely a typo
  // of a provider the flow offers: that is reported on the schema, so the
  // provider it was meant to be is not reported again here.
  when: (fact) => {
    return (
      fact.schema.isSsoEnabled &&
      (fact.connection !== undefined || fact.broken) &&
      !fact.schema.lists(fact.slug) &&
      !fact.meant.includes(fact.slug)
    );
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
    return `${where}: sso provider ${quote(fact.slug)} is not listed in sso.providers of ${fact.schema.path}. Add it there, or remove it from the flow.`;
  },
});
