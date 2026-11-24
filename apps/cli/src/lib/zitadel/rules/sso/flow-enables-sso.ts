import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";

export const FLOW_ENABLES_SSO: Rule = defineRule({
  id: "sso/flow-enables-sso",
  severity: "error",
  each: (config) => {
    return config.flows.all.flatMap((flow) => {
      const schema = config.flows.findSchemaOf(flow);
      if (schema === undefined) {
        return [];
      }
      return flow.steps.map((step) => {
        return { flow, step, schema };
      });
    });
  },
  when: (fact) => {
    return fact.step.providers.length > 0 && !fact.schema.isSsoEnabled;
  },
  file: (fact) => {
    return fact.flow.path;
  },
  steps: {
    step: (fact) => {
      return fact.step.name;
    },
    cause: () => {
      return "";
    },
  },
  says: (fact, where) => {
    return `${where}: offers sso_providers but "sso" is not an enabled authentication method in ${fact.schema.path}. Enable it there, or remove sso_providers.`;
  },
});
