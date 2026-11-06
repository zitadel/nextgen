import { join } from "node:path";

import { describe, expect } from "vitest";

import { test } from "./fixtures";
import { runStageChecks, hasProject, snapshotSchema } from "./support/checks";
import { converse } from "./support/conversation";
import { journey } from "./support/journey";
import { gradeStage, parseStage } from "./support/lib";
import { settings } from "./support/settings";

const FIRST_STAGE = journey.stages[0]?.id;
const stages = journey.stages.filter((stage) => !settings.stages || settings.stages.has(stage.id));

/**
 * One scenario's journey: a developer's common questions asked of an agent that
 * has (or, for a baseline, lacks) the zitadel-cli skill, run as one stateful
 * conversation in a container. Each stage passes only when the live instance
 * and the scaffolded app show the outcome, whatever the agent said. A baseline
 * is recorded for the report's comparison and not asserted: it is expected to
 * fail without the skill.
 */
describe("zitadel-cli skill journey", () => {
  for (const stage of stages) {
    test(`stage ${stage.id}: ${stage.title}`, async ({
      agent,
      workspace,
      results,
      scenario,
      skip,
      task,
    }) => {
      task.meta.resultsDir = results;
      if (stage.id !== FIRST_STAGE && !hasProject(workspace)) {
        skip("stage 1 left no project, so there is nothing to act on");
      }
      const stageFile = join(results, `stage${stage.id}.jsonl`);

      await converse(agent, stage, scenario, stageFile);
      snapshotSchema(workspace, results, stage.id);
      await runStageChecks(agent, stage, results);

      if (!scenario.skill) {
        return;
      }
      const grade = gradeStage(stage, results, parseStage(stageFile), true);
      expect(grade.status, grade.why).toBe("pass");
    });
  }
});
