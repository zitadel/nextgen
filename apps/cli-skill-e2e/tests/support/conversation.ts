import { appendFileSync } from "node:fs";

import type { Stage } from "../../src/journey.ts";
import type { Scenario } from "../../scenarios.ts";
import type { AgentClient, Turn } from "./agent-client.ts";
import { settings } from "./settings.ts";

const DONE = "DONE";

const isDone = (answer: string): boolean => answer === "" || answer.endsWith(DONE);

/**
 * Drive one stage as a real conversation, so the agent can prompt the user.
 * "Non-interactive" only ever described how the agent drives the CLI; the
 * agent may still ask the developer, and a simulated one answers from the
 * stage's persona until the agent is done or the question cap is hit. The
 * whole exchange is appended to `stageFile` in the stream-json shape the
 * report reads.
 */
export async function converse(
  agent: AgentClient,
  stage: Stage,
  scenario: Scenario,
  stageFile: string,
): Promise<void> {
  const maxTurns = scenario.skill ? settings.maxTurns : settings.baselineMaxTurns;
  const record = (turn: Turn): Turn => {
    if (turn.lines.length > 0) {
      // The turn's start anchors the first model step: without it the time
      // before the agent's first message could not be told from startup.
      appendFileSync(
        stageFile,
        `${JSON.stringify({ type: "turn_start", _t: turn.startedAt })}\n${turn.lines.join("\n")}\n`,
      );
    }
    // A turn that was killed prints no result of its own; without one, an
    // earlier turn's clean result would stand for the whole stage.
    if (turn.isError) {
      appendFileSync(
        stageFile,
        `${JSON.stringify({ type: "result", is_error: true, subtype: "turn_failed", num_turns: 0, duration_ms: 0 })}\n`,
      );
    }
    return turn;
  };

  /** Let the developer answer, then resume the agent, until it is done or `remaining` runs out. */
  const answerAndResume = async (turn: Turn, remaining: number): Promise<void> => {
    if (remaining === 0 || turn.isError || stage.user === undefined) {
      return;
    }
    const asked = Date.now();
    const answer = await agent.simulatedUser({
      persona: stage.user,
      agentText: turn.lastText,
      model: settings.simModel,
    });
    if (isDone(answer)) {
      return;
    }
    // `_ms` is how long the simulated developer took to answer, so the report
    // can show it apart from the agent's own time.
    appendFileSync(
      stageFile,
      `${JSON.stringify({ type: "sim_user", text: answer, _ms: Date.now() - asked })}\n`,
    );
    const next = record(
      await agent.turn({
        prompt: answer,
        model: scenario.model,
        maxTurns,
        sessionId: turn.sessionId,
      }),
    );
    return answerAndResume(next, remaining - 1);
  };

  const first = record(await agent.turn({ prompt: stage.prompt, model: scenario.model, maxTurns }));
  // The baseline gets a single capped attempt: an agent that never found the
  // CLI does not earn rounds of the user spelling out requirements it can't use.
  if (scenario.skill) {
    await answerAndResume(first, settings.maxQa);
  }
}
