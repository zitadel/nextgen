import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";

export const COLLECTION_CONFLICT_ROUTING: Rule = defineRule({
  id: "sso/collection-conflict-routing",
  severity: "error",
  each: (config) => {
    return config.flows.all.flatMap((flow) => {
      return flow.steps.map((step) => {
        return { flow, step };
      });
    });
  },
  when: (fact) => {
    return fact.step.createsUserFromSso && !fact.step.routes.has("user_already_exists");
  },
  file: (fact) => {
    return fact.flow.path;
  },
  steps: {
    step: (fact) => {
      return fact.step.name;
    },
    cause: (fact) => {
      return String(fact.step.collisionCarriesAction);
    },
  },
  says: (fact, where) => {
    if (fact.step.collisionCarriesAction) {
      return `${where}: on_success create_user_with_sso must route user_already_exists, and an SSO collision is followed only through a transition with no action. Remove the action from it.`;
    }
    return `${where}: on_success create_user_with_sso must route user_already_exists. Add that transition.`;
  },
});
