import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { quote } from "@/lib/zitadel/rules/sso/shared";

export const EMPTY_VERIFIED_CLAIMS: Rule = defineRule({
  id: "sso/empty-verified-claims",
  severity: "warning",
  // A key no listing schema defines is already the error
  // sso/orphaned-verification-key, so it is not reported again here. Only a
  // warning: another schema that lists the connection may define the keys.
  each: (config) => {
    return config.flows.pinnedOffers.flatMap((offer) => {
      const connection = offer.connection;
      if (connection === undefined || !connection.createsUsers) {
        return [];
      }
      // A pinned schema that does not list the provider is already refused at
      // the step by sso/provider-id.
      if (!offer.schema.providers.includes(offer.slug)) {
        return [];
      }
      const keys = connection.verifications.map((row) => {
        return row.property;
      });
      if (keys.length === 0) {
        return [];
      }
      return [{ ...offer, connection, keys, listing: config.schemas.listOffering(offer.slug) }];
    });
  },
  when: (fact) => {
    const allUnknown =
      fact.listing.length > 0 &&
      fact.keys.every((key) => {
        return !fact.listing.some((schema) => {
          return schema.has(key);
        });
      });
    const verifiesSomething = fact.keys.some((key) => {
      return fact.schema.has(key);
    });
    return !allUnknown && !verifiesSomething;
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
    return `${where}: verified_claims of ${quote(fact.slug)} (${fact.connection.path}) names nothing ${fact.schema.path} defines, so no sign-in can verify anything for this user type. Verify a property of ${fact.schema.path} in ${fact.connection.path}, or remove verified_claims.`;
  },
});
