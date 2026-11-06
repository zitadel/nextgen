import { scenarios, selectScenarios } from "./scenarios.ts";

const MINUTE = 60_000;

/**
 * Two kinds of project. `unit` is fast and safe to run anywhere. Each `eval:*`
 * project is one scenario from `scenarios.ts` — it starts a container, spends
 * Claude tokens and takes tens of minutes, so it runs only on request
 * (`pnpm eval`), never as part of `pnpm test`.
 */
export default {
  test: {
    reporters: ["default", "./tests/support/html-report-reporter.ts"],
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      ...selectScenarios(scenarios, process.env.EVAL_SCENARIOS).map((scenario) => ({
        test: {
          name: `eval:${scenario.name}`,
          include: ["tests/journey.eval.test.ts"],
          provide: { scenario },
          testTimeout: 40 * MINUTE,
          hookTimeout: 40 * MINUTE,
        },
      })),
    ],
  },
};
