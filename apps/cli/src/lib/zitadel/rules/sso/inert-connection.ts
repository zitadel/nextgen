import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { closest } from "@/lib/zitadel/utils/spelling";
import {
  heldByBrokenConnection,
  knownSlugs,
  quote,
  standing,
} from "@/lib/zitadel/rules/sso/shared";

/**
 * A connection file that no schema lists, so no user type can use it.
 *
 * @remarks
 * Why it matters: Nothing can offer a connection no schema lists, so the file does nothing. It is
 * only a warning because the file may be written ahead of the schema that will list it.
 *
 * Reported once: A connection a flow offers is not judged, because sso/provider-id already refuses
 * that step. A project with an external schema is not judged, because what a remote schema lists
 * cannot be known here. A connection that is the nearest match to a slug a schema lists with no
 * file is not reported, because that typo is already an error from sso/connection-resolves with a
 * Did you mean. A connection the server already has is judged like any other: only the files in
 * the project count.
 *
 * Fix: List the slug in sso.providers of a schema, or delete the file.
 *
 * Origin: #3287 (Inert Connection of #1083);
 * docs/design/idp/1-resource-model.md#validator-rules.
 */
export const INERT_CONNECTION: Rule = defineRule({
  id: "sso/inert-connection",
  severity: "warning",
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
