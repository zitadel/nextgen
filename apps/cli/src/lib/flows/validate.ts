import { ZitadelError } from "../errors";
import { type FlowDefinition, flowDefinitionSchema } from "./schema";

/**
 * Validate raw JSON bodies against {@link flowDefinitionSchema} and
 * return the parsed shapes. Errors from every input are collected
 * and rethrown as a single `E_VALIDATION` `ZitadelError` so callers
 * see the full picture at once rather than failing on the first
 * malformed entry.
 *
 * Pure: does not touch the filesystem or network. The input array
 * is read-only; the returned array is freshly allocated.
 *
 * @param flows - Raw values to validate. Unknown-typed so callers
 *   can pass freshly-parsed JSON without first asserting a shape.
 */
export function validateFlows(
  flows: ReadonlyArray<unknown>,
): ReadonlyArray<FlowDefinition> {
  const issues: Array<{ index: number; issues: unknown }> = [];
  const parsed: FlowDefinition[] = [];
  for (let i = 0; i < flows.length; i += 1) {
    const result = flowDefinitionSchema.safeParse(flows[i]);
    if (!result.success) {
      issues.push({ index: i, issues: result.error.issues });
      continue;
    }
    parsed.push(result.data);
  }
  if (issues.length > 0) {
    throw new ZitadelError("E_VALIDATION", "One or more flow definitions are invalid", {
      details: { issues },
    });
  }
  return parsed;
}
