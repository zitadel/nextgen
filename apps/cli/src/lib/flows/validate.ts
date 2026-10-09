import type { CreateFlowDefinitionBodyFlowDefinition } from "@zitadel/api/generated/model";
import { flowConfigSchema } from "@zitadel/config/schemas";

import { ZitadelError } from "../errors";

/**
 * On-disk flow bodies validate against the canonical `flowConfigSchema`
 * from `@zitadel/config/schemas` — the inner `flow_definition` shape of the
 * generated create-envelope — so every consumer (sync, doctor, this batch
 * validator) applies exactly the same rules.
 */
const flowDefinitionBodySchema = flowConfigSchema;

/**
 * Validate raw JSON bodies against the generated flow-definition Zod
 * schema (the orval-emitted equivalent of
 * `api/openapi/components/flows/flow-definition.yaml`). Errors from
 * every input are collected and rethrown as a single `E_VALIDATION`
 * `ZitadelError` so callers see the full picture at once rather than
 * failing on the first malformed entry.
 *
 * Pure: does not touch the filesystem or network. The input array
 * is read-only; the returned array is freshly allocated.
 *
 * @param flows - Raw values to validate. Unknown-typed so callers
 *   can pass freshly-parsed JSON without first asserting a shape.
 */
export function validateFlows(
  flows: ReadonlyArray<unknown>,
): ReadonlyArray<CreateFlowDefinitionBodyFlowDefinition> {
  const issues: Array<{ index: number; issues: unknown }> = [];
  const parsed: CreateFlowDefinitionBodyFlowDefinition[] = [];
  for (let i = 0; i < flows.length; i += 1) {
    const result = flowDefinitionBodySchema.safeParse(flows[i]);
    if (!result.success) {
      issues.push({ index: i, issues: result.error.issues });
      continue;
    }
    parsed.push(result.data as CreateFlowDefinitionBodyFlowDefinition);
  }
  if (issues.length > 0) {
    throw new ZitadelError("E_VALIDATION", "One or more flow definitions are invalid", {
      details: { issues },
    });
  }
  return parsed;
}
