/**
 * The server's own rules for a login flow, run against the user schema the
 * flow pins: the same port `deploy` has always run, with the server's
 * messages, so a dry run says what the server would say.
 */

import { flowConfigSchema, schemaConfigSchema } from "@zitadel/config/schemas";
import { type FlowValidationIssue, validateFlowDefinition } from "@zitadel/config/validate";

import type { Flow } from "@/lib/zitadel/flows/flow";
import type { JsonObject } from "@/lib/zitadel/types";
import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";

/**
 * One finding of the server's flow rules about one flow.
 */
type FlowFinding = Readonly<{
  /**
   * The flow the finding is about.
   */
  flow: Flow;

  /**
   * What the server's rules found.
   */
  issue: FlowValidationIssue;
}>;

/**
 * A body without the editor-only `$schema` pointer.
 *
 * @param body - A file's body.
 * @returns The body the server judges.
 */
function judged(body: JsonObject): JsonObject {
  const { $schema: _editorOnly, ...rest } = body;
  return rest;
}

/**
 * The server's flow rules, as one rule that reports each under the server's
 * own id.
 */
export const FLOW_RULES: readonly Rule[] = [
  defineRule({
    id: "contract/flow",
    severity: "error",
    // The flow rules assume a flow its contract takes, so a flow the contract
    // refuses is reported there and not judged here; so is a schema, which is
    // then left out and the schema-aware rules skipped.
    each: (config) => {
      return config.flows.all.flatMap((flow): FlowFinding[] => {
        if (!flowConfigSchema.safeParse(judged(flow.body)).success) {
          return [];
        }
        const pinned = config.flows.schemaOf(flow);
        const schema =
          pinned !== undefined && schemaConfigSchema.safeParse(judged(pinned.body)).success
            ? judged(pinned.body)
            : undefined;
        return validateFlowDefinition(judged(flow.body), schema).map((issue) => {
          return { flow, issue };
        });
      });
    },
    rule: (finding) => {
      return finding.issue.rule;
    },
    severityOf: (finding) => {
      return finding.issue.severity;
    },
    file: (finding) => {
      return finding.flow.path;
    },
    says: (finding) => {
      return finding.issue.message;
    },
  }),
];
