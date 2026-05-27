import type { FlowDefinition } from "./schema";

/**
 * Extract every distinct `text_key` referenced by the flow. The result
 * is sorted ascending and deduplicated, so callers can use it directly
 * as the key set for a locale dictionary. Input is treated as read-only;
 * the returned array is newly allocated.
 *
 * @param flow - A validated {@link FlowDefinition}.
 */
export function collectTextKeys(flow: Readonly<FlowDefinition>): ReadonlyArray<string> {
  const keys = new Set<string>();
  for (const step of flow.steps) {
    if (step.texts?.title_key) {
      keys.add(step.texts.title_key);
    }
    if (step.texts?.description_key) {
      keys.add(step.texts.description_key);
    }
    for (const field of Object.values(step.fields)) {
      keys.add(field.text_key);
    }
    for (const action of Object.values(step.actions)) {
      keys.add(action.text_key);
    }
  }
  return [...keys].sort();
}
