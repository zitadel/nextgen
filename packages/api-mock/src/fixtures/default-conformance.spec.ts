/**
 * Default-conformance guard for the step fixtures.
 *
 * AGENTS.md requires every fixture change to be diffed against the shipped
 * default flow (`packages/config/defaults/default-login.json`); this spec
 * automates exactly that diff for the per-step ACTION surface, so the mock
 * can neither miss an action the default declares nor grow an undeclared
 * extra that masks divergence.
 *
 * Three categories:
 * - default-declared: must match the default exactly, name for name.
 * - engine-injected: actions the real engine adds at runtime that a
 *   definition never declares (ADR 022 `back`).
 * - mock-only: intentional extras kept so screens without a real path stay
 *   reachable for Storybook and tests. Every entry must stay ABSENT from
 *   the default — when one becomes real, this spec fails until the entry
 *   is removed, keeping the allowlist honest.
 */
// The raw JSON export, not `@zitadel/config/defaults`: importing the TS
// module would pull config source into this package's narrower TS program
// (spec lib/target) via the `@zitadel/source` condition. Action names are
// identical in the raw template.
import defaultLogin from "@zitadel/config/defaults/default-login.json";
import { describe, expect, it } from "vitest";

import {
  identifierStep,
  passkeyUpsellStep,
  passwordStep,
  registerPasswordStep,
  registerStep,
  type StepFixtureInput,
} from "./login.js";

type FlowStepShape = {
  name: string;
  actions?: Array<{ name: string }>;
};

const input: StepFixtureInput = {
  flowId: "flow_conformance",
  sessionToken: "tok_conformance",
  iss: "http://localhost:8080",
};

/** Fixture builder per default step name; `done` is terminal and has none. */
const FIXTURES = {
  identifier: identifierStep,
  password: passwordStep,
  register: registerStep,
  "register-password": registerPasswordStep,
  "passkey-upsell": passkeyUpsellStep,
} as const;

/** ADR 022: the engine injects `back` on steps with a predecessor. */
const ENGINE_INJECTED = new Set(["back"]);

/**
 * Intentional mock-only extras, by step. Keep this list small and
 * documented:
 * - `identifier.recover`: the default flow defines no recovery step yet;
 *   the mock keeps the screen reachable for Storybook and tests.
 */
const MOCK_ONLY: Record<string, readonly string[]> = {
  identifier: ["recover"],
};

const defaultFlow = defaultLogin as unknown as { steps: FlowStepShape[] };

function defaultStep(name: string): FlowStepShape {
  const step = defaultFlow.steps.find((s) => s.name === name);
  if (!step) throw new Error(`default flow step ${name} missing`);
  return step;
}

describe("fixture action surface vs default-login.json", () => {
  for (const [stepName, builder] of Object.entries(FIXTURES)) {
    it(`${stepName}: serves exactly the default's actions plus documented extras`, () => {
      const declared = (defaultStep(stepName).actions ?? []).map((a) => a.name);
      const mockOnly = MOCK_ONLY[stepName] ?? [];

      const served = (builder(input).step.actions ?? []).map((a) => a.name ?? "");
      const surplus = served.filter(
        (name) => !ENGINE_INJECTED.has(name) && !mockOnly.includes(name),
      );

      expect(surplus.sort()).toEqual([...declared].sort());
    });
  }

  it("mock-only extras stay absent from the default flow", () => {
    for (const [stepName, extras] of Object.entries(MOCK_ONLY)) {
      const declared = (defaultStep(stepName).actions ?? []).map((a) => a.name);
      for (const extra of extras) {
        expect(
          declared,
          `${stepName}.${extra} is now real — remove it from MOCK_ONLY`,
        ).not.toContain(extra);
      }
    }
  });
});
