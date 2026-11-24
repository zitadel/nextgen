import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { quote } from "@/lib/zitadel/rules/sso/shared";

export const EMPTY_CLAIM_MAPPING: Rule = defineRule({
  id: "sso/empty-claim-mapping",
  severity: "error",
  each: (config) => {
    return config.flows.pinnedOffers.flatMap((offer) => {
      const connection = offer.connection;
      // A provider that only signs people in fills no user, so what it maps
      // does not matter.
      if (connection === undefined || !connection.createsUsers) {
        return [];
      }
      return [{ ...offer, connection, listing: config.schemas.listOffering(offer.slug) }];
    });
  },
  // When no schema that lists the connection defines any mapped name, each
  // name is already reported as unknown, and fixing those fixes this too.
  when: (fact) => {
    const mapped = fact.connection.mappings;
    const allUnknown =
      mapped.length > 0 &&
      fact.listing.length > 0 &&
      mapped.every((row) => {
        return !fact.listing.some((schema) => {
          return schema.has(row.property);
        });
      });
    const fillsSomething = mapped.some((row) => {
      return fact.schema.has(row.property);
    });
    return !allUnknown && !fillsSomething;
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
    const what =
      fact.connection.mappings.length === 0
        ? "is empty"
        : `maps nothing ${fact.schema.path} defines`;
    return `${where}: claim_mapping of ${quote(fact.slug)} (${fact.connection.path}) ${what}, so no sign-in can fill the user. Map at least one property of ${fact.schema.path} in ${fact.connection.path}.`;
  },
});
