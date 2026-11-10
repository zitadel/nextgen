import { journeyNames } from "./src/journey.ts";
import { scenarios, selectScenarios } from "./scenarios.ts";

const MINUTE = 60_000;

/** How many times each scenario runs, as separate projects so they run side by side. */
const repeats = Math.max(1, Number(process.env.EVAL_REPEATS ?? "1"));

/**
 * How many runs go at once. Each is a container with a Next dev server,
 * Chromium and the agent, so an unbounded fan-out exhausts Docker's memory.
 */
const parallel = Math.max(1, Number(process.env.EVAL_PARALLEL ?? "2"));

/**
 * Each project is one scenario run from `scenarios.ts`: it starts a container,
 * spends Claude tokens and takes tens of minutes, so it runs only on request
 * (`pnpm eval`).
 */
const chosenJourneys = (process.env.EVAL_JOURNEYS ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const journeys = journeyNames().filter(
  (name) => chosenJourneys.length === 0 || chosenJourneys.includes(name),
);

const projects = journeys.flatMap((journey) =>
  selectScenarios(scenarios, process.env.EVAL_SCENARIOS).flatMap((scenario) =>
    Array.from({ length: repeats }, (_, index) => index + 1).map((repeat) => ({
      test: {
        name: `eval:${scenario.name}:${journey}${repeats === 1 ? "" : `:r${repeat}`}`,
        include: ["tests/journey.eval.test.ts"],
        provide: { scenario, repeat, journey },
        testTimeout: 40 * MINUTE,
        hookTimeout: 40 * MINUTE,
      },
    })),
  ),
);

/** Unit tests mirror their source file and need no container, so they always run. */
const unit = { test: { name: "unit", include: ["src/**/*.test.ts"] } };

export default { test: { maxWorkers: parallel, projects: [unit, ...projects] } };
