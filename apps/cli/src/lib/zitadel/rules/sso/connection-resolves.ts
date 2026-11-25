import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { didYouMean } from "@/lib/zitadel/utils/spelling";
import { heldByBrokenConnection, knownSlugs, quote } from "@/lib/zitadel/rules/sso/shared";

/**
 * The rules that find a provider with no connection file, one for the schemas and one for the
 * flows.
 */
export const CONNECTION_RESOLVES: readonly Rule[] = [
  /**
   * A schema's sso.providers lists a provider that has no connection file under .zitadel/idps/.
   *
   * @remarks
   * Why it matters: Nothing can sign in through a provider that has no connection, so its button
   * would lead nowhere.
   *
   * Reported once: A slug held by a connection file the contract refuses is not reported, because
   * the contract finding already says what is wrong with that file. The message names the slug it
   * was most likely meant to be.
   *
   * Fix: Add the connection file, or remove the provider from sso.providers.
   *
   * Origin: #1703 (cross-resource resolution, issue #1044); moved to the CLI by #2889;
   * docs/design/idp/2-auth-method-selection.md#validation-rules.
   */
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

  /**
   * A flow step offers a provider that has no connection file under .zitadel/idps/.
   *
   * @remarks
   * Why it matters: Nothing can sign in through a provider that has no connection, so its button
   * would lead nowhere.
   *
   * Reported once: A provider the flow's schema also lists is reported once, on the schema, since
   * one missing file is one mistake. A slug held by a connection file the contract refuses is not
   * reported, because the contract finding already says what is wrong with that file.
   *
   * Fix: Add the connection file, or remove the provider from the flow.
   *
   * Origin: #1703 (cross-resource resolution, issue #1044); moved to the CLI by #2889;
   * docs/design/idp/2-auth-method-selection.md#validation-rules.
   */
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
