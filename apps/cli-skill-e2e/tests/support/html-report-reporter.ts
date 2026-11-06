import { spawnSync } from "node:child_process";
import { join } from "node:path";

import type { Reporter, TestModule } from "vitest/node";

import { packageRoot, settings } from "./settings";

/**
 * Builds the journey report once an eval run ends. Each journey test leaves
 * its results folder in `task.meta.resultsDir`; a run that produced none (the
 * unit project) builds nothing. The report is `scripts/report.mjs`, which
 * reads every scenario under the output folder, so a run of one scenario still
 * shows the others' earlier results beside it.
 */
export default class HtmlReportReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const ranAJourney = testModules.some((module) =>
      [...module.children.allTests()].some((test) => Boolean(test.meta().resultsDir)),
    );
    if (!ranAJourney) {
      return;
    }
    const built = spawnSync(process.execPath, [join(packageRoot, "scripts/report.mjs")], {
      stdio: "inherit",
      env: { ...process.env, OUT: settings.outDir },
    });
    if (built.status !== 0) {
      return;
    }
    const html = join(settings.outDir, "journey.html");
    console.log(`report: ${html}`);
    if (process.env.OPEN_REPORT === "0" || process.env.CI) {
      return;
    }
    const opener = process.platform === "darwin" ? ["open", "-a", "Google Chrome"] : ["xdg-open"];
    spawnSync(opener[0] as string, [...opener.slice(1), html], { stdio: "ignore" });
  }
}
