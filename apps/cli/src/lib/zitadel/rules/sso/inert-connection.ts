import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { closest } from "@/lib/zitadel/utils/spelling";
import {
  heldByBrokenConnection,
  knownSlugs,
  quote,
  standing,
} from "@/lib/zitadel/rules/sso/shared";

export const INERT_CONNECTION: Rule = defineRule({
  id: "sso/inert-connection",
  severity: "warning",
  // A connection a flow offers but no schema lists is already refused by
  // sso/provider-id at the step, so it is not reported again here. A schema
  // that lists a slug with no file, whose nearest connection this is, is a
  // typo that sso/connection-resolves already reports with a suggestion.
  each: (config) => {
    if (
      config.schemas.all.some((schema) => {
        return schema.isExternal;
      })
    ) {
      return [];
    }
    const known = knownSlugs(config);
    const mistyped = config.schemas.all
      .flatMap((schema) => {
        return schema.providers;
      })
      .filter((slug) => {
        return config.connections.find(slug) === undefined && !heldByBrokenConnection(config, slug);
      })
      .map((slug) => {
        return closest(slug, known);
      });
    return standing(config).filter((entry) => {
      const offered = config.flows.offers.some((offer) => {
        return offer.slug === entry.slug;
      });
      return entry.listing.length === 0 && !offered && !mistyped.includes(entry.slug);
    });
  },
  file: (fact) => {
    return fact.connection.path;
  },
  says: (fact) => {
    return `connection ${quote(fact.slug)} is listed in sso.providers by no schema, so no user type can use it. List ${quote(fact.slug)} in sso.providers of a schema, or delete this file.`;
  },
});
