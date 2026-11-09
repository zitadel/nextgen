/**
 * The server's own rules for a login flow, run against the user schema the
 * flow pins: the same port `deploy` has always run, with the server's
 * messages, so a dry run says what the server would say. A flow that offers
 * a provider but pins no local schema is said aloud too, since its provider
 * rules are then not checked against a schema.
 */

import { flowConfigSchema, schemaConfigSchema } from "@zitadel/config/schemas";
import { type FlowValidationIssue, validateFlowDefinition } from "@zitadel/config/validate";

import type { Flow } from "@/lib/zitadel/resources/flows/flow";
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
 * own id, and the warning for a flow offering a provider that pins no local
 * schema.
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
  defineRule({
    id: "flow/unpinned-schema",
    severity: "warning",
    // A flow that offers a provider is held to the provider rules against the
    // schema it pins. When no local schema is the one, those rules pass by not
    // running, which is said aloud rather than left to look like a pass.
    each: (config) => {
      return config.flows.all.filter((flow) => {
        return config.flows.schemaOf(flow) === undefined && flow.offers();
      });
    },
    file: (flow) => {
      return flow.path;
    },
    says: () => {
      return "could not tell which local schema this flow pins, so its provider rules were not checked against a schema";
    },
  }),
];
