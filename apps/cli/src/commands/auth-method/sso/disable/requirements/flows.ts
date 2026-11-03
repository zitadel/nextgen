import { refuseUneditable } from "../../../../../lib/auth-methods";
import { type FlowFile, ssoEditRefusal, ssoProvidersRefusal } from "../../../../../lib/idp";
import { requirement } from "../../../../../lib/oclif/requirements";
import type { SchemaTarget } from "../../../requirements/target";

/**
 * The flows a provider is removed from, once the schema and each flow are in
 * the shapes the editors write: a region that is not what they write is
 * someone's, and is not overwritten.
 */
export const removableFlows = requirement<FlowFile[]>({
  resolve: async ({ resolved }) => {
    const { schema, flows } = resolved.target as SchemaTarget;
    refuseUneditable(schema.path, ssoEditRefusal(schema.body, "schema"));
    for (const flow of flows) {
      refuseUneditable(flow.path, ssoProvidersRefusal(flow.body));
    }
    return flows;
  },
});
