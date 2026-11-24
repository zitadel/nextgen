import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { closest } from "@/lib/zitadel/utils/spelling";
import { heldByBrokenConnection, knownSlugs, quote } from "@/lib/zitadel/rules/sso/shared";

/**
 * A flow step offers a provider that the schema it is pinned to does not list in sso.providers.
 *
 * @remarks
 * Why it matters: The schema decides which providers a user may sign in with, so the step offers a
 * button that the schema refuses.
 *
 * Reported once: A slug the schema lists without a connection file is most likely a typo of a
 * provider the flow offers. That is reported on the schema by sso/connection-resolves, so the
 * provider it was meant to be is not reported again here. It is also silent when SSO is not enabled
 * in the schema, which sso/flow-enables-sso reports, and for a provider with no connection file,
 * which sso/connection-resolves reports.
 *
 * Fix: Add the provider to sso.providers of the schema, or remove it from the flow.
 *
 * Origin: #1703 (Provider ID validity, issue #1044); moved to the CLI by #2889;
 * docs/design/idp/2-auth-method-selection.md#validation-rules.
 */
export const PROVIDER_ID: Rule = defineRule({
  id: "sso/provider-id",
  severity: "error",
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
