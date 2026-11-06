import { scenarios, selectScenarios } from "./scenarios.ts";

const MINUTE = 60_000;

/** How many times each scenario runs, as separate projects so they run side by side. */
const repeats = Math.max(1, Number(process.env.EVAL_REPEATS ?? "1"));

/**
 * Each project is one scenario run from `scenarios.ts`: it starts a container,
 * spends Claude tokens and takes tens of minutes, so it runs only on request
 * (`pnpm eval`).
 */
const projects = selectScenarios(scenarios, process.env.EVAL_SCENARIOS).flatMap((scenario) =>
  Array.from({ length: repeats }, (_, index) => index + 1).map((repeat) => ({
    test: {
      name: repeats === 1 ? `eval:${scenario.name}` : `eval:${scenario.name}:r${repeat}`,
      include: ["tests/journey.eval.test.ts"],
      provide: { scenario, repeat },
      testTimeout: 40 * MINUTE,
      hookTimeout: 40 * MINUTE,
    },
  })),
);

export default { test: { projects } };
