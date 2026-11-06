import { appendFileSync } from "node:fs";

import type { AgentClient, Turn } from "./agent-client";
import type { Stage } from "./journey";
import { settings } from "./settings";
import type { Scenario } from "../../scenarios";

const DONE = "DONE";

/**
 * Drive one stage as a real conversation, so the agent can prompt the user.
 * "Non-interactive" only ever described how the agent drives the CLI; the agent
 * may still ask the developer, and a simulated one answers from the stage's
 * persona until the agent is done or the Q&A cap is hit. The whole exchange is
 * appended to `stageFile` in the stream-json shape the report reads.
 */
export async function converse(
  agent: AgentClient,
  stage: Stage,
  scenario: Scenario,
  stageFile: string,
): Promise<void> {
  const maxTurns = scenario.skill ? settings.maxTurns : settings.baselineMaxTurns;
  const model = scenario.model;
  const record = (turn: Turn): void => {
    if (turn.lines.length > 0) {
      appendFileSync(stageFile, `${turn.lines.join("\n")}\n`);
    }
  };

  let turn = await agent.turn({ prompt: stage.prompt, model, maxTurns });
  record(turn);

  // The baseline gets a single capped attempt: an agent that never found the
  // CLI does not earn rounds of the user spelling out requirements it can't use.
  if (!stage.user || turn.isError || !scenario.skill) {
    return;
  }
  for (let round = 0; round < settings.maxQa; round += 1) {
    const answer = await agent.simulatedUser({
      persona: stage.user,
      agentText: turn.lastText,
      model: settings.simModel,
    });
    if (!answer || answer === DONE || answer.endsWith(DONE)) {
      return;
    }
    appendFileSync(stageFile, `${JSON.stringify({ type: "sim_user", text: answer })}\n`);
    turn = await agent.turn({ prompt: answer, model, maxTurns, sessionId: turn.sessionId });
    record(turn);
    if (turn.isError) {
      return;
    }
  }
}
