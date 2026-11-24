import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { quote } from "@/lib/zitadel/rules/sso/shared";

export const DEAD_CAPABILITY: Rule = defineRule({
  id: "sso/dead-capability",
  severity: "warning",
  // A schema no flow runs against is not reported: nothing could offer its
  // providers yet, which is a project still being set up. A slug with no
  // connection file is reported by sso/connection-resolves.
  each: (config) => {
    return config.schemas.all.flatMap((schema) => {
      const flows = config.flows.findForSchema(schema);
      if (!schema.isSsoEnabled || flows.length === 0) {
        return [];
      }
      return [...new Set(schema.providers)]
        .filter((slug) => {
          const offered = config.flows.offers.some((offer) => {
            return flows.includes(offer.flow) && offer.slug === slug;
          });
          return config.connections.find(slug) !== undefined && !offered;
        })
        .map((slug) => {
          return { schema, slug };
        });
    });
  },
  file: (fact) => {
    return fact.schema.path;
  },
  slug: (fact) => {
    return fact.slug;
  },
  says: (fact) => {
    return `sso.providers lists ${quote(fact.slug)} but no flow that runs against this schema offers it on any step, so no login page shows it. Add ${quote(fact.slug)} to sso_providers of a step, or remove it from sso.providers.`;
  },
});
