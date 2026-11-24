import type { Step } from "@/lib/zitadel/resources/flows/step";
import { PROVIDER_OUTCOMES, type ProviderOutcome } from "@/lib/zitadel/resources/flows/types";
import type { ZitadelConfig } from "@/lib/zitadel/config";
import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";

/**
 * The outcome every step offering a provider must route, and the only one a
 * step offering only providers that never create users needs.
 */
const SIGNED_IN_OUTCOMES = ["sso_authenticated"] as const satisfies readonly ProviderOutcome[];

/**
 * The outcomes a step offering providers must route but does not. A provider
 * that never creates users never returns an unknown identity, so a step that
 * offers only such providers needs only `sso_authenticated`.
 *
 * @param config - The configuration.
 * @param step - The step.
 * @returns The outcomes it is missing.
 */
function unroutedOutcomes(config: ZitadelConfig, step: Step): readonly ProviderOutcome[] {
  const offersCreation = step.providers.some((slug) => {
    return config.connections.find(slug)?.createsUsers ?? true;
  });
  const required: readonly ProviderOutcome[] = offersCreation
    ? PROVIDER_OUTCOMES
    : SIGNED_IN_OUTCOMES;
  return required.filter((outcome) => {
    return !step.routes.has(outcome);
  });
}

export const OUTCOME_ROUTING: Rule = defineRule({
  id: "sso/outcome-routing",
  severity: "error",
  each: (config) => {
    return config.flows.all.flatMap((flow) => {
      return flow.steps.map((step) => {
        return { flow, step, missing: unroutedOutcomes(config, step) };
      });
    });
  },
  when: (fact) => {
    return fact.step.providers.length > 0 && fact.missing.length > 0;
  },
  file: (fact) => {
    return fact.flow.path;
  },
  steps: {
    step: (fact) => {
      return fact.step.name;
    },
    cause: (fact) => {
      return fact.missing.join();
    },
  },
  says: (fact, where) => {
    const advice =
      fact.step.collisionCarriesAction && fact.missing.includes("user_already_exists")
        ? "A collision is followed only through a user_already_exists transition with no action, so remove its action. Add a transition for the rest."
        : "Add a transition for each.";
    return `${where}: offers sso_providers but does not route ${fact.missing.join(", ")}. ${advice}`;
  },
});
