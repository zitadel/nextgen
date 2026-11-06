import { join } from "node:path";

import { describe, expect, inject } from "vitest";

import { gradeStage } from "../src/grading.ts";
import { loadJourney } from "../src/journey.ts";
import { parseStage } from "../src/transcript.ts";
import { test } from "./fixtures.ts";
import { cliSpecOf, hasProject, runStageChecks, snapshotSchema } from "./support/checks.ts";
import { converse } from "./support/conversation.ts";
import { settings } from "./support/settings.ts";

const journey = loadJourney(inject("journey"));
const allStages = journey.stages;
const firstStage = allStages[0]?.id;
const stages = allStages.filter((stage) => settings.stages?.has(stage.id) ?? true);

/**
 * One scenario's journey: a developer's common questions asked of an agent
 * that has (or, for a baseline, lacks) the zitadel-cli skill, run as one
 * stateful conversation in a container. Each stage passes only when the live
 * instance and the scaffolded app show the outcome, whatever the agent said.
 * A baseline is recorded for the report's comparison and not asserted: it is
 * expected to fail without the skill.
 */
describe(`zitadel-cli skill journey: ${journey.name}`, () => {
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
      if (stage.id !== firstStage && !hasProject(workspace)) {
        skip("stage 1 left no project, so there is nothing to act on");
      }
      const stageFile = join(results, `stage${stage.id}.jsonl`);

      if (stage.prepare !== undefined) {
        const prepared = await agent.exec({ file: "bash", args: ["-lc", stage.prepare] });
        expect(prepared.status, prepared.stderr).toBe(0);
      }

      await converse(agent, stage, scenario, stageFile);
      snapshotSchema(workspace, results, stage.id);
      await runStageChecks(agent, stage, results, cliSpecOf(journey));

      if (scenario.skill) {
        const grade = gradeStage(stage, results, parseStage(stageFile), true);
        expect(grade.status, grade.why).toBe("pass");
      }
    });
  }
});
