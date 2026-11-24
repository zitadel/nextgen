import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { quote } from "@/lib/zitadel/rules/sso/shared";

/**
 * A flow offers a provider whose claim_mapping fills no property of the schema the flow is pinned
 * to.
 *
 * @remarks
 * Why it matters: The provider can create users, but no sign-in can fill the user, so every sign-up
 * stops to collect everything.
 *
 * Reported once: Silent for a provider that only signs people in and creates no users, because what
 * it maps does not matter. Silent when no schema that lists the connection defines any mapped name,
 * since each name is then already reported as unknown by sso/orphaned-mapping-target and fixing
 * those fixes this too.
 *
 * Fix: Map at least one property of the schema in the connection file.
 *
 * Origin: #1703 (Empty claim_mapping intersection, issue #1044, raised from a warning to an error);
 * moved to the CLI by #2889; docs/design/idp/2-auth-method-selection.md#validation-rules.
 */
export const EMPTY_CLAIM_MAPPING: Rule = defineRule({
  id: "sso/empty-claim-mapping",
  severity: "error",
  each: (config) => {
    return config.flows.pinnedOffers.flatMap((offer) => {
      const connection = offer.connection;
      if (connection === undefined || !connection.createsUsers) {
        return [];
      }
      return [{ ...offer, connection, listing: config.schemas.listOffering(offer.slug) }];
    });
  },
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
