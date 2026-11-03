import { refuseUneditable } from "../../../../../lib/auth-methods";
import { type FlowFile, ssoEditRefusal } from "../../../../../lib/idp";
import { requirement, unmet } from "../../../../../lib/oclif/requirements";
import type { SchemaTarget } from "../../../requirements/target";

/**
 * The flows a provider must be added to. No flow means no button however well
 * everything else went, so a run without one is refused before anything is
 * asked or written, as is a schema or flow with a region the editors cannot
 * recognise and would write over.
 */
export const ssoFlows = requirement<FlowFile[]>({
  refusal: {
    code: "E_NOT_FOUND",
    message: "No login flow runs against {schema}",
    hint:
      "The provider is offered by a flow, and none of the files under .zitadel/flows/ " +
      "names this schema. Check that the flow's user_schema names the schema's objectType.",
    details: {
      schema: "{path}",
    },
  },
  resolve: async ({ resolved }) => {
    const { schema, flows } = resolved.target as SchemaTarget;
    if (flows.length === 0) {
      return unmet({
        schema: schema.name,
        path: schema.path,
      });
    }
    refuseUneditable(schema.path, ssoEditRefusal(schema.body, "schema"));
    for (const flow of flows) {
      refuseUneditable(flow.path, ssoEditRefusal(flow.body, "flow"));
    }
    return flows;
  },
});
