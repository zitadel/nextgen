import { spawnSync } from "node:child_process";

import type { Reporter, TestModule } from "vitest/node";

import { buildReport, journeysWithResults } from "../../src/report/build.ts";
import { settings } from "./settings.ts";

/** A journey test leaves the folder of its results in `task.meta.resultsDir`. */
const ranAJourney = (modules: ReadonlyArray<TestModule>): boolean =>
  modules.some((module) =>
    [...module.children.allTests()].some((test) => Boolean(test.meta().resultsDir)),
  );

const opener = (): ReadonlyArray<string> =>
  process.platform === "darwin" ? ["open", "-a", "Google Chrome"] : ["xdg-open"];

/**
 * Builds the journey report once an eval run ends. It acts only when a test
 * recorded `resultsDir`, so the unit tests, which record none, build nothing.
 * It reads every scenario under the output folder, so a run of one scenario
 * still shows the others' earlier results beside it. `OPEN_REPORT=0` (or `CI`)
 * builds the file without opening it.
 */
export default class HtmlReportReporter implements Reporter {
  onTestRunEnd(modules: ReadonlyArray<TestModule>): void {
    if (!ranAJourney(modules)) {
      return;
    }
    const reports = journeysWithResults(settings.outDir).map((journey) =>
      buildReport(settings.outDir, journey),
    );
    for (const report of reports) {
      console.log(`report: ${report}`);
    }
    if (process.env.OPEN_REPORT !== "0" && process.env.CI === undefined) {
      const [command = "open", ...args] = opener();
      spawnSync(command, [...args, ...reports], { stdio: "ignore" });
    }
  }
}
