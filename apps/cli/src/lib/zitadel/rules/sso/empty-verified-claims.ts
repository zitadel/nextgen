import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { quote } from "@/lib/zitadel/rules/sso/shared";

/**
 * A connection that creates users has verified_claims keys, and none of them is a property of the
 * flow's schema.
 *
 * @remarks
 * Why it matters: Every property of that user type arrives unverified, so where a required
 * property is unique the automatic creation can never pass and sign-up stops at the collection
 * step. It is only a warning because another schema that lists the connection may define the keys.
 *
 * Reported once: A key no listing schema defines is the error sso/orphaned-verification-key, so it
 * is not reported again here. A pinned schema that does not list the provider is refused at the
 * step by sso/provider-id. A connection that does not create users, or has no verified_claims, is
 * not judged.
 *
 * Fix: Verify a property of the schema in verified_claims, or remove verified_claims.
 *
 * Origin: #3287 (Empty verified_claims intersection of #1083);
 * docs/design/idp/2-auth-method-
 * selection.md#validation-rules.
 */
export const EMPTY_VERIFIED_CLAIMS: Rule = defineRule({
  id: "sso/empty-verified-claims",
  severity: "warning",
  each: (config) => {
    return config.flows.pinnedOffers.flatMap((offer) => {
      const connection = offer.connection;
      if (connection === undefined || !connection.createsUsers) {
        return [];
      }
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
