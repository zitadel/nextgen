/** One way of running the journey: which model drives the agent, and whether it has the skill. */
export interface Scenario {
  name: string;
  model: string;
  skill: boolean;
  enabled: boolean;
}

/**
 * Every scenario the eval knows. Only the enabled ones run by default, each as
 * its own Vitest project; `EVAL_SCENARIOS=haiku,sonnet-baseline` runs exactly
 * those names instead, enabled or not.
 */
export const scenarios: Scenario[] = [
  { name: "opus", model: "claude-opus-5-5", skill: true, enabled: true },
  { name: "sonnet", model: "claude-sonnet-5-5", skill: true, enabled: true },
  { name: "haiku", model: "claude-haiku-4-5-20251001", skill: true, enabled: false },
  { name: "sonnet-baseline", model: "claude-sonnet-5-5", skill: false, enabled: false },
];

export function selectScenarios(all: Scenario[], only = ""): Scenario[] {
  const names = only
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) {
    return all.filter((scenario) => scenario.enabled);
  }
  return all.filter((scenario) => names.includes(scenario.name));
}
