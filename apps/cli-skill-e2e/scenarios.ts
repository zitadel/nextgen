/** One way of running the journey: which model drives the agent, and whether it has the skill. */
export interface Scenario {
  readonly name: string;
  readonly model: string;
  readonly skill: boolean;
  readonly enabled: boolean;
}

/**
 * Every scenario the eval knows. Only the enabled ones run by default, each as
 * its own Vitest project; `EVAL_SCENARIOS=haiku,sonnet-baseline` runs exactly
 * those names instead, enabled or not.
 */
export const scenarios: ReadonlyArray<Scenario> = [
  { name: "opus", model: "claude-opus-5-5", skill: true, enabled: true },
  { name: "sonnet", model: "claude-sonnet-5-5", skill: true, enabled: true },
  { name: "haiku", model: "claude-haiku-4-5-20251001", skill: true, enabled: false },
  { name: "sonnet-baseline", model: "claude-sonnet-5-5", skill: false, enabled: false },
];

export function selectScenarios(all: ReadonlyArray<Scenario>, only = ""): ReadonlyArray<Scenario> {
  const names = only
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length === 0
    ? all.filter((scenario) => scenario.enabled)
    : all.filter((scenario) => names.includes(scenario.name));
}
