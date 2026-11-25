import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { quote } from "@/lib/zitadel/rules/sso/shared";

/**
 * The providers a list names more than once, which offers their button twice.
 *
 * @param providers - The providers, as listed.
 * @returns Each repeated provider once, in the order first repeated.
 */
function repeatedProviders(providers: readonly string[]): readonly string[] {
  return [
    ...new Set(
      providers.filter((provider, index) => {
        return providers.indexOf(provider) !== index;
      }),
    ),
  ];
}

/**
 * The rules that find a provider listed twice, one for a schema's sso.providers and one for a flow
 * step's sso_providers.
 */
export const DUPLICATE_PROVIDER: readonly Rule[] = [
  /**
   * A schema's sso.providers lists the same provider twice.
   *
   * @remarks
   * Why it matters: A duplicate entry is a mistake in the list the schema's sign-in methods are
   * built from.
   *
   * Reported once: Each repeated provider is reported once, however many times it repeats.
   *
   * Fix: List each provider once.
   *
   * Origin: #2889; docs/design/idp/2-auth-method-selection.md#validation-rules as Duplicate
   * Provider.
   */
  defineRule({
    id: "sso/duplicate-provider",
    severity: "error",
    each: (config) => {
      return config.schemas.all.flatMap((schema) => {
        return repeatedProviders(schema.providers).map((slug) => {
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
      return `sso.providers lists ${quote(fact.slug)} more than once. List each provider once.`;
    },
  }),

  /**
   * A flow step's sso_providers lists the same provider twice.
   *
   * @remarks
   * Why it matters: The step offers that provider's button twice.
   *
   * Reported once: Steps with the same repeated provider are one mistake, reported together as one
   * finding naming every step.
   *
   * Fix: List each provider once.
   *
   * Origin: #2889; docs/design/idp/2-auth-method-selection.md#validation-rules as Duplicate
   * Provider.
   */
  defineRule({
    id: "sso/duplicate-provider",
    severity: "error",
    each: (config) => {
      return config.flows.all.flatMap((flow) => {
        return flow.steps.flatMap((step) => {
          return repeatedProviders(step.providers).map((slug) => {
            return { flow, step, slug };
          });
        });
      });
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
      return `${where}: sso_providers lists ${quote(fact.slug)} more than once, which offers its button twice. List each provider once.`;
    },
  }),
];
