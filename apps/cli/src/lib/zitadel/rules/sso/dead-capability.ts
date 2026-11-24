import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { quote } from "@/lib/zitadel/rules/sso/shared";

/**
 * A schema's sso.providers lists a provider that no flow running against that schema offers on any
 * step.
 *
 * @remarks
 * Why it matters: The Console shows the provider as a way to sign in for this user type, but no
 * login page carries its button. It is only a warning because the connection works once a flow
 * offers it.
 *
 * Reported once: A slug with no connection file is reported by sso/connection-resolves. A schema
 * with SSO disabled is not judged.
 *
 * Deviation from the design: The design row reads "a schema lists a provider that no flow offers".
 * This rule stays silent for a schema no flow runs against, because nothing could offer its
 * providers yet and the project is still being set up; a flow that runs against the schema and
 * offers none of its providers is what it reports.
 *
 * Fix: Add the slug to sso_providers of a step, or remove it from sso.providers.
 *
 * Origin: #3287 (Dead capability of #1083);
 * docs/design/idp/2-auth-method-selection.md#validation-rules.
 */
export const DEAD_CAPABILITY: Rule = defineRule({
  id: "sso/dead-capability",
  severity: "warning",
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
