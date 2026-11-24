import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { didYouMean } from "@/lib/zitadel/utils/spelling";
import { heldByBrokenConnection, knownSlugs, quote } from "@/lib/zitadel/rules/sso/shared";

export const CONNECTION_RESOLVES: readonly Rule[] = [
  defineRule({
    id: "sso/connection-resolves",
    severity: "error",
    each: (config) => {
      const known = knownSlugs(config);
      return config.schemas.all.flatMap((schema) => {
        return [...new Set(schema.providers)].map((slug) => {
          return {
            schema,
            slug,
            known,
            connection: config.connections.find(slug),
            broken: heldByBrokenConnection(config, slug),
          };
        });
      });
    },
    when: (fact) => {
      return fact.connection === undefined && !fact.broken;
    },
    file: (fact) => {
      return fact.schema.path;
    },
    slug: (fact) => {
      return fact.slug;
    },
    says: (fact) => {
      return `sso.providers lists ${quote(fact.slug)} but there is no connection file with that slug under .zitadel/idps/.${didYouMean(fact.slug, fact.known)} Add the file, or remove ${quote(fact.slug)} from sso.providers.`;
    },
  }),

  defineRule({
    id: "sso/connection-resolves",
    severity: "error",
    each: (config) => {
      const known = knownSlugs(config);
      return config.flows.offers.map((offer) => {
        return {
          ...offer,
          known,
          schema: config.flows.findSchemaOf(offer.flow),
          broken: heldByBrokenConnection(config, offer.slug),
        };
      });
    },
    // A provider the flow's schema also lists is reported once, on the
    // schema, since one missing file is one mistake.
    when: (fact) => {
      return (
        fact.connection === undefined && !fact.broken && fact.schema?.lists(fact.slug) !== true
      );
    },
    file: (fact) => {
      return fact.flow.path;
    },
    slug: (fact) => {
      return fact.slug;
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
      return `${where}: sso provider ${quote(fact.slug)} has no connection file with that slug under .zitadel/idps/.${didYouMean(fact.slug, fact.known)} Add the file, or remove the provider from the flow.`;
    },
  }),
];
